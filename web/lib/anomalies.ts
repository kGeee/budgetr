import { db } from "@/db";
import { dismissedAlerts } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Anomaly detection — actionable alerts derived on the fly from `transactions`
 * and `recurring_streams`. Nothing here is persisted except the user's dismiss /
 * snooze action (see lib/actions-alerts.ts), keyed by a deterministic `alertKey`
 * so the same real-world event always maps to the same row.
 *
 * Four kinds:
 *  - spike     — a vendor's last-30d spend jumped ≥3× its trailing-90d baseline.
 *  - duplicate — the same vendor charged an identical amount twice within 3 days.
 *  - creep     — a recurring charge's latest amount crept >15% above its average,
 *                or a brand-new active outflow stream appeared.
 *  - trial     — an active outflow that looks like a free / intro trial about to
 *                convert to a full charge within the next 7 days.
 *
 * All figures are read synchronously (better-sqlite3), so `detectAnomalies()` is
 * a plain sync function callable straight from server components.
 */

export type AlertKind = "spike" | "duplicate" | "creep" | "trial";
export type AlertSeverity = "high" | "medium" | "low";

export type Alert = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  vendor?: string;
  amount?: number;
  date?: string;
};

// Ignore spikes/duplicates below this dollar floor — small amounts aren't worth
// a user's attention and produce noisy false positives.
const SPIKE_FLOOR = 40;
const DUPLICATE_FLOOR = 15;
const SPIKE_RATIO = 3;
const CREEP_RATIO = 1.15;
const TRIAL_FLOOR = 5; // "small" last amount that smells like a $0/intro trial

// Raw vendor key per transaction — merchant name when Plaid gives us one, else
// the raw descriptor. Mirrors lib/queries.ts so grouping stays consistent.
const vendorKeyExpr = sql`COALESCE(NULLIF(t.merchant_name, ''), t.name)`;

// ── spike ─────────────────────────────────────────────────────────────────

type SpikeRow = {
  vendorKey: string;
  recent: number; // last 30d spend
  baseline: number; // avg 30d-window spend over the trailing 90d before that
};

function detectSpikes(): Alert[] {
  // For each vendor: sum spend in the last 30d, and sum spend in the 90d window
  // ending 30 days ago (the baseline period). Divide the baseline by 3 to get a
  // comparable per-30d average.
  const rows = db.all<SpikeRow>(sql`
    SELECT ${vendorKeyExpr} AS vendorKey,
           SUM(CASE WHEN t.date >= date('now', '-30 days') AND t.amount > 0
                    THEN t.amount ELSE 0 END) AS recent,
           SUM(CASE WHEN t.date < date('now', '-30 days')
                     AND t.date >= date('now', '-120 days') AND t.amount > 0
                    THEN t.amount ELSE 0 END) / 3.0 AS baseline
    FROM transactions t
    WHERE t.pending = 0 AND t.amount > 0
      AND t.date >= date('now', '-120 days')
    GROUP BY vendorKey
    HAVING recent >= ${SPIKE_FLOOR} AND baseline > 0 AND recent >= baseline * ${SPIKE_RATIO}
    ORDER BY recent DESC`);

  const bucket = new Date().toISOString().slice(0, 7); // month bucket
  return rows.map((r) => {
    const ratio = r.recent / r.baseline;
    return {
      key: `spike:${r.vendorKey}:${bucket}`,
      kind: "spike" as const,
      severity: ratio >= 5 ? "high" : ("medium" as AlertSeverity),
      title: `${ratio.toFixed(1)}× your usual at ${r.vendorKey}`,
      detail: `You spent ${fmt(r.recent)} in the last 30 days versus a typical ${fmt(
        r.baseline,
      )}.`,
      vendor: r.vendorKey,
      amount: r.recent,
    };
  });
}

// ── duplicate ───────────────────────────────────────────────────────────────

type DuplicateRow = {
  vendorKey: string;
  amount: number;
  firstDate: string;
  secondDate: string;
  txnId: string;
};

function detectDuplicates(): Alert[] {
  // Self-join transactions on identical vendor + amount within 3 days. `b.id > a.id`
  // dedupes the mirror pair; we surface the later charge as the suspicious one.
  const rows = db.all<DuplicateRow>(sql`
    SELECT COALESCE(NULLIF(a.merchant_name, ''), a.name) AS vendorKey, a.amount AS amount,
           a.date AS firstDate, b.date AS secondDate, b.id AS txnId
    FROM transactions a
    JOIN transactions b
      ON b.id > a.id
     AND COALESCE(NULLIF(b.merchant_name, ''), b.name) = COALESCE(NULLIF(a.merchant_name, ''), a.name)
     AND b.amount = a.amount
     AND ABS(julianday(b.date) - julianday(a.date)) <= 3
     AND b.pending = 0 AND a.pending = 0
     AND a.amount > 0
    WHERE a.amount > ${DUPLICATE_FLOOR}
      AND a.date >= date('now', '-90 days')
    ORDER BY b.date DESC`);

  return rows.map((r) => ({
    key: `duplicate:${r.vendorKey}:${r.txnId}`,
    kind: "duplicate" as const,
    severity: (r.amount >= 100 ? "high" : "medium") as AlertSeverity,
    title: `Possible duplicate charge at ${r.vendorKey}`,
    detail: `Two ${fmt(r.amount)} charges on ${r.firstDate} and ${r.secondDate}.`,
    vendor: r.vendorKey,
    amount: r.amount,
    date: r.secondDate,
  }));
}

// ── creep + trial (recurring streams) ────────────────────────────────────────

type StreamRow = {
  id: string;
  merchant: string | null;
  averageAmount: number | null;
  lastAmount: number | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  status: string | null;
  updatedAt: number;
};

function loadOutflowStreams(): StreamRow[] {
  return db.all<StreamRow>(sql`
    SELECT r.id AS id,
           COALESCE(NULLIF(r.merchant_name, ''), r.description) AS merchant,
           r.average_amount AS averageAmount, r.last_amount AS lastAmount,
           r.last_date AS lastDate, r.predicted_next_date AS predictedNextDate,
           r.status AS status, r.updated_at AS updatedAt
    FROM recurring_streams r
    WHERE r.is_active = 1 AND r.direction = 'outflow'`);
}

function detectCreep(streams: StreamRow[]): Alert[] {
  const alerts: Alert[] = [];
  for (const s of streams) {
    const name = s.merchant ?? "a subscription";
    const last = Math.abs(s.lastAmount ?? 0);
    const avg = Math.abs(s.averageAmount ?? 0);

    // Price creep: latest charge exceeds the running average by >15%.
    if (avg > 0 && last > 0 && last >= avg * CREEP_RATIO && last - avg >= 1) {
      const pct = ((last - avg) / avg) * 100;
      alerts.push({
        key: `creep:${s.id}:${last.toFixed(2)}`,
        kind: "creep",
        severity: pct >= 30 ? "high" : "medium",
        title: `${name} went up ${pct.toFixed(0)}%`,
        detail: `Latest charge ${fmt(last)} is above the usual ${fmt(avg)}.`,
        vendor: name,
        amount: last,
        date: s.lastDate ?? undefined,
      });
    }
  }
  return alerts;
}

function detectTrials(streams: StreamRow[]): Alert[] {
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const alerts: Alert[] = [];
  for (const s of streams) {
    if (!s.predictedNextDate) continue;
    if (s.predictedNextDate < today || s.predictedNextDate > in7) continue;

    const last = Math.abs(s.lastAmount ?? 0);
    const looksLikeTrial = s.status === "EARLY_DETECTION" || last <= TRIAL_FLOOR;
    if (!looksLikeTrial) continue;

    const name = s.merchant ?? "a subscription";
    alerts.push({
      key: `trial:${s.id}:${s.predictedNextDate}`,
      kind: "trial",
      severity: "high",
      title: `${name} is about to bill`,
      detail:
        last <= TRIAL_FLOOR
          ? `A trial (last charge ${fmt(last)}) is set to convert on ${s.predictedNextDate}.`
          : `Newly detected charge expected on ${s.predictedNextDate}.`,
      vendor: name,
      amount: s.averageAmount ? Math.abs(s.averageAmount) : undefined,
      date: s.predictedNextDate,
    });
  }
  return alerts;
}

// ── public entry point ───────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Compute all live alerts, filtering out any the user has dismissed (snoozeUntil
 * null) or snoozed until a future date. Sorted most-severe first.
 */
export function detectAnomalies(): Alert[] {
  const streams = loadOutflowStreams();
  const all = [
    ...detectSpikes(),
    ...detectDuplicates(),
    ...detectCreep(streams),
    ...detectTrials(streams),
  ];

  // Suppress dismissed / still-snoozed keys.
  const today = new Date().toISOString().slice(0, 10);
  const suppressed = new Set(
    db
      .select({ alertKey: dismissedAlerts.alertKey, snoozeUntil: dismissedAlerts.snoozeUntil })
      .from(dismissedAlerts)
      .all()
      .filter((d) => d.snoozeUntil === null || d.snoozeUntil >= today)
      .map((d) => d.alertKey),
  );

  return all
    .filter((a) => !suppressed.has(a.key))
    .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}
