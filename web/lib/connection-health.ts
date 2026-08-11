/**
 * Per-institution connection health.
 *
 * Every figure in the app is downstream of when its institution last reported,
 * and until now nothing surfaced that anywhere: a Plaid item could sit in
 * `status: 'error'` for weeks while the accounts page rendered its frozen
 * balance in exactly the same treatment as six healthy ones. The crypto wallet
 * card has always shown "synced <time>"; the seven banks showed nothing.
 *
 * Two different timestamps matter here and they are easy to confuse:
 *
 *   - `items.updatedAt` is the last sync *attempt*. syncAllItems writes it on
 *     failure too, so a broken item looks recently touched.
 *   - `MAX(accounts.updatedAt)` for the item is the last sync that actually
 *     returned balances — the real "this data is as of" moment.
 *
 * Health is keyed off the second. The first only tells us whether anything has
 * tried lately.
 */

import { db } from "@/db";
import { accounts, items } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/** Days without a successful refresh before a live connection reads as stale. */
export const STALE_AFTER_DAYS = 3;

export type ConnectionState = "live" | "stale" | "error";

export type ConnectionHealth = {
  itemId: string;
  institutionName: string;
  state: ConnectionState;
  /** Raw Plaid error code, when the item is in an error state. */
  errorCode: string | null;
  /** Display-ready explanation of the state. Never contains a raw code alone. */
  message: string;
  /** Last sync that actually returned balances, or null if it never has. */
  lastSuccessAt: Date | null;
  /** Whole days since that success. Infinity when there has never been one. */
  daysSinceSuccess: number;
  accountCount: number;
};

/**
 * Plaid error codes we can explain in the user's terms, and — importantly —
 * whether re-linking is the actual remedy. Anything unmapped falls back to the
 * raw code, which is still better than silence.
 */
const ERROR_COPY: Record<string, string> = {
  NO_ACCOUNTS:
    "This institution reports no accounts we can access. Re-linking is the only fix.",
  ITEM_LOGIN_REQUIRED: "Your bank needs you to sign in again before it will share data.",
  ITEM_LOCKED: "Your bank has locked the account. Sign in on their site, then reconnect.",
  PENDING_EXPIRATION: "This connection expires soon. Reconnect to keep it alive.",
  INVALID_CREDENTIALS: "The saved sign-in for this bank is no longer valid.",
  INVALID_MFA: "The bank's security check needs redoing.",
  INSUFFICIENT_CREDENTIALS: "Your bank is asking for another sign-in step.",
  INVALID_ACCESS_TOKEN: "This link is no longer valid and needs to be recreated.",
  INSTITUTION_DOWN: "The bank's connection is down. This usually resolves on its own.",
  INSTITUTION_NOT_RESPONDING: "The bank isn't responding. Try again shortly.",
};

const DAY_MS = 86_400_000;

function daysBetween(from: Date, to: number): number {
  return Math.floor((to - from.getTime()) / DAY_MS);
}

/** How long ago, in the phrasing the UI uses. */
export function describeAge(days: number): string {
  if (!Number.isFinite(days)) return "never";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/** The item fields classification needs. */
export type ItemFacts = {
  itemId: string;
  institutionName: string | null;
  status: string;
  error: string | null;
};

/** Per-item account aggregates: how many, and when they last refreshed. */
export type ItemAccountStats = {
  count: number;
  /** Unix *seconds*, as stored — not milliseconds. */
  lastSuccess: number | null;
};

/**
 * Turn one item plus its account stats into a display-ready health record.
 * Pure, so the state boundaries and the error copy are testable without a
 * database (the same split as resolvePlaidConfig in lib/app-config).
 */
export function classifyConnection(
  item: ItemFacts,
  stats: ItemAccountStats,
  now = Date.now(),
): ConnectionHealth {
  // `updatedAt` is a timestamp-mode integer column; a raw max() over it comes
  // back as the stored unix seconds rather than hydrated to a Date.
  const lastSuccessAt = stats.lastSuccess ? new Date(stats.lastSuccess * 1000) : null;
  const daysSinceSuccess = lastSuccessAt ? daysBetween(lastSuccessAt, now) : Infinity;
  const institutionName = item.institutionName ?? "Unnamed institution";
  const accountCount = stats.count;

  if (item.status === "error") {
    const code = item.error ?? null;
    return {
      itemId: item.itemId,
      institutionName,
      state: "error",
      errorCode: code,
      message:
        (code && ERROR_COPY[code]) ??
        (code ? `Your bank returned ${code}.` : "This connection is failing."),
      lastSuccessAt,
      daysSinceSuccess,
      accountCount,
    };
  }

  const stale = daysSinceSuccess >= STALE_AFTER_DAYS;
  return {
    itemId: item.itemId,
    institutionName,
    state: stale ? "stale" : "live",
    errorCode: null,
    message: stale
      ? `Last updated ${describeAge(daysSinceSuccess)}.`
      : `Updated ${describeAge(daysSinceSuccess)}.`,
    lastSuccessAt,
    daysSinceSuccess,
    accountCount,
  };
}

/**
 * Health for every real (non-manual) Plaid link, worst first, so a caller can
 * take `[0]` for the single most urgent thing to say.
 */
export function getConnectionHealth(now = Date.now()): ConnectionHealth[] {
  const rows = db.select().from(items).where(eq(items.source, "plaid")).all();

  // Deliberately a separate grouped query rather than a correlated subquery:
  // inside a `sql` template Drizzle emits column names unqualified, so
  // `WHERE item_id = id` resolves BOTH sides against the subquery's own table
  // and silently matches nothing. Two plain queries joined here can't misbind.
  const stats = new Map<string, { count: number; lastSuccess: number | null }>();
  for (const row of db
    .select({
      itemId: accounts.itemId,
      count: sql<number>`count(*)`,
      lastSuccess: sql<number | null>`max(${accounts.updatedAt})`,
    })
    .from(accounts)
    .groupBy(accounts.itemId)
    .all()) {
    if (row.itemId) {
      stats.set(row.itemId, {
        count: Number(row.count),
        lastSuccess: row.lastSuccess === null ? null : Number(row.lastSuccess),
      });
    }
  }

  const health = rows.map((r) =>
    classifyConnection(
      {
        itemId: r.id,
        institutionName: r.institutionName,
        status: r.status,
        error: r.error,
      },
      stats.get(r.id) ?? { count: 0, lastSuccess: null },
      now,
    ),
  );

  const rank: Record<ConnectionState, number> = { error: 0, stale: 1, live: 2 };
  return health.sort(
    (a, b) => rank[a.state] - rank[b.state] || b.daysSinceSuccess - a.daysSinceSuccess,
  );
}

export type ConnectionSummary = {
  all: ConnectionHealth[];
  /** Worst-state connection, or null when every link is healthy. */
  worst: ConnectionHealth | null;
  liveCount: number;
  total: number;
  /** Days since the most recently refreshed link — how fresh the app is at best. */
  daysSinceAnySync: number;
};

export function getConnectionSummary(now = Date.now()): ConnectionSummary {
  const all = getConnectionHealth(now);
  const liveCount = all.filter((c) => c.state === "live").length;
  const freshest = all.reduce(
    (min, c) => Math.min(min, c.daysSinceSuccess),
    Infinity as number,
  );
  return {
    all,
    worst: all.length > 0 && all[0].state !== "live" ? all[0] : null,
    liveCount,
    total: all.length,
    daysSinceAnySync: freshest,
  };
}

/**
 * Health keyed by the institution name the accounts page groups on. Where two
 * items share a name, the worse state wins — a half-broken bank is broken.
 */
export function getHealthByInstitution(now = Date.now()): Map<string, ConnectionHealth> {
  const map = new Map<string, ConnectionHealth>();
  // getConnectionHealth is already worst-first, so the first write per name wins.
  for (const c of getConnectionHealth(now)) {
    if (!map.has(c.institutionName)) map.set(c.institutionName, c);
  }
  return map;
}
