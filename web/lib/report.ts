/**
 * Period report assembly.
 *
 * `buildReportData(period, currency)` gathers the same aggregates the /review
 * page shows — totals, top vendors, category breakdown + shifts, biggest
 * purchases, the month-by-month bar, and the net-worth series — into one plain,
 * fully serializable object. Every stored figure is in the ledger's USD storage
 * currency, so we convert each to the chosen display currency here (via
 * lib/rates.ts) rather than at format time, so the object is self-contained and
 * can be rendered by both the printable /report route and the email HTML string
 * (renderReportHtml) without any module-scoped currency state.
 */

import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import {
  getBiggestPurchases,
  getCategories,
  getCategorySpendForPeriod,
  getDailySpendRange,
  getDisplayCurrencySetting,
  getMonthlySpendForYear,
  getNetWorthSeries,
  getPeriodTotals,
  getTopMerchantsForPeriod,
  type BiggestPurchase,
  type CategoryRow,
  type CategorySpend,
  type PeriodTotals,
  type TopMerchant,
} from "@/lib/queries";
import { convert, getCachedRates } from "@/lib/rates";
import { currencyFromCookie } from "@/lib/currency";

export const REPORT_PERIODS = [
  "this-month",
  "last-month",
  "this-year",
  "last-year",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
};

/** Coerce an arbitrary string into a valid period key (defaults to this-month). */
export function reportPeriodFromParam(raw: string | undefined): ReportPeriod {
  return REPORT_PERIODS.includes(raw as ReportPeriod)
    ? (raw as ReportPeriod)
    : "this-month";
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Resolve a period key to inclusive [start, end] bounds plus the immediately
 * preceding equal-length window (for category-shift deltas), a human label, and
 * the calendar year the month-by-month bar should chart. Mirrors the same
 * resolution used by app/review/page.tsx.
 */
function resolvePeriod(period: ReportPeriod, now: Date) {
  switch (period) {
    case "last-month": {
      const m = subMonths(now, 1);
      const prev = subMonths(m, 1);
      return {
        label: format(m, "MMMM yyyy"),
        prevLabel: format(prev, "MMMM"),
        start: iso(startOfMonth(m)),
        end: iso(endOfMonth(m)),
        prevStart: iso(startOfMonth(prev)),
        prevEnd: iso(endOfMonth(prev)),
        year: m.getFullYear(),
      };
    }
    case "this-year": {
      const prev = subYears(now, 1);
      return {
        label: format(now, "yyyy"),
        prevLabel: format(prev, "yyyy"),
        start: iso(startOfYear(now)),
        end: iso(endOfYear(now)),
        prevStart: iso(startOfYear(prev)),
        prevEnd: iso(endOfYear(prev)),
        year: now.getFullYear(),
      };
    }
    case "last-year": {
      const y = subYears(now, 1);
      const prev = subYears(now, 2);
      return {
        label: format(y, "yyyy"),
        prevLabel: format(prev, "yyyy"),
        start: iso(startOfYear(y)),
        end: iso(endOfYear(y)),
        prevStart: iso(startOfYear(prev)),
        prevEnd: iso(endOfYear(prev)),
        year: y.getFullYear(),
      };
    }
    case "this-month":
    default: {
      const prev = subMonths(now, 1);
      return {
        label: format(now, "MMMM yyyy"),
        prevLabel: format(prev, "MMMM"),
        start: iso(startOfMonth(now)),
        end: iso(endOfMonth(now)),
        prevStart: iso(startOfMonth(prev)),
        prevEnd: iso(endOfMonth(prev)),
        year: now.getFullYear(),
      };
    }
  }
}

export type CategoryShift = {
  category: string;
  icon: string | null;
  current: number;
  prev: number;
  delta: number;
};

export type ReportData = {
  period: ReportPeriod;
  /** Human label for the window, e.g. "June 2026" or "2026". */
  label: string;
  /** Label of the comparison window used for category shifts. */
  prevLabel: string;
  /** ISO 4217 the figures below are already expressed in. */
  currency: string;
  /** ISO timestamp the report was assembled. */
  generatedAt: string;
  /** No transactions recorded in the window. */
  empty: boolean;
  totals: PeriodTotals;
  topVendors: TopMerchant[];
  biggest: BiggestPurchase[];
  categories: CategorySpend[];
  shifts: CategoryShift[];
  monthlySpend: { month: string; spent: number }[];
  year: number;
  netWorth: { date: string; netWorth: number }[];
  /** Latest point of the net-worth series (0 when there are no snapshots). */
  netWorthCurrent: number;
  /** Trailing-year daily spend for the heatmap, plus its window + categories. */
  heatmap: { date: string; spent: number }[];
  heatmapStart: string;
  heatmapEnd: string;
  categoryMeta: CategoryRow[];
};

/**
 * Assemble the full report for `period`, converted into `currency` (defaults to
 * the persisted display-currency setting). Pure aggregation over the sync query
 * layer — safe to call from a server component, a server action, or a route
 * handler. Returns a plain object with no module-state dependencies.
 */
export function buildReportData(
  period: ReportPeriod,
  currency?: string | null,
): ReportData {
  const display = currency ? currencyFromCookie(currency) : getDisplayCurrencySetting();
  const rates = getCachedRates("USD");
  // Every stored figure is USD; conv maps it into the display currency (identity
  // when USD or when a rate is missing, so a cold cache degrades gracefully).
  const conv = (v: number) => convert(v, "USD", display, rates);

  const now = new Date();
  const p = resolvePeriod(period, now);

  const rawTotals = getPeriodTotals(p.start, p.end);
  const totals: PeriodTotals = {
    income: conv(rawTotals.income),
    expenses: conv(rawTotals.expenses),
    net: conv(rawTotals.net),
    txCount: rawTotals.txCount,
  };

  const topVendors = getTopMerchantsForPeriod(p.start, p.end, 8).map((v) => ({
    ...v,
    total: conv(v.total),
  }));

  const biggest = getBiggestPurchases(p.start, p.end, 6).map((b) => ({
    ...b,
    amount: conv(b.amount),
  }));

  const rawCategories = getCategorySpendForPeriod(p.start, p.end);
  const categories = rawCategories.map((c) => ({ ...c, total: conv(c.total) }));
  const prevCategories = getCategorySpendForPeriod(p.prevStart, p.prevEnd);

  // Category shifts vs the prior equal-length window, keyed by category id (or
  // name for uncategorized). Biggest movers first, in either direction.
  const prevByKey = new Map(prevCategories.map((c) => [c.categoryId ?? c.category, c.total]));
  const seen = new Set<string>();
  const shifts: CategoryShift[] = [
    ...rawCategories.map((c) => {
      const key = c.categoryId ?? c.category;
      seen.add(key);
      const prev = prevByKey.get(key) ?? 0;
      return {
        category: c.category,
        icon: c.icon,
        current: conv(c.total),
        prev: conv(prev),
        delta: conv(c.total - prev),
      };
    }),
    ...prevCategories
      .filter((c) => !seen.has(c.categoryId ?? c.category))
      .map((c) => ({
        category: c.category,
        icon: c.icon,
        current: 0,
        prev: conv(c.total),
        delta: conv(-c.total),
      })),
  ]
    .filter((s) => s.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  const monthlySpend = getMonthlySpendForYear(p.year).map((m) => ({
    ...m,
    spent: conv(m.spent),
  }));

  const netWorth = getNetWorthSeries().map((n) => ({
    ...n,
    netWorth: conv(n.netWorth),
  }));
  const netWorthCurrent = netWorth.length ? netWorth[netWorth.length - 1].netWorth : 0;

  // Heatmap: trailing ~53 weeks aligned to a Sunday so grid columns are whole
  // weeks. Left in USD — SpendHeatmap converts via the shared display-currency
  // module state on the client, matching the rest of the app.
  const heatmapEnd = iso(now);
  const heatmapStart = iso(startOfWeek(subDays(now, 364), { weekStartsOn: 0 }));
  const heatmap = getDailySpendRange(heatmapStart, heatmapEnd);
  const categoryMeta = getCategories();

  return {
    period,
    label: p.label,
    prevLabel: p.prevLabel,
    currency: display,
    generatedAt: now.toISOString(),
    empty: rawTotals.txCount === 0,
    totals,
    topVendors,
    biggest,
    categories,
    shifts,
    monthlySpend,
    year: p.year,
    netWorth,
    netWorthCurrent,
    heatmap,
    heatmapStart,
    heatmapEnd,
    categoryMeta,
  };
}

/**
 * Format a figure already expressed in `currency`. Unlike lib/utils.formatMoney
 * this neither converts (buildReportData already did) nor applies privacy-mode
 * scaling — a report is a real document, so it shows real numbers.
 */
export function formatReportMoney(
  amount: number,
  currency: string,
  opts: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...opts,
  }).format(amount);
}

// ── Email HTML ────────────────────────────────────────────────────────────────
// A single self-contained HTML string shared by the email 'send' stub and the
// route handler. Inline styles only (email clients strip <style>/external CSS),
// no charts — a clean textual digest of the same numbers the /report page shows.

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Render `data` to a standalone HTML document suitable for an email body. */
export function renderReportHtml(data: ReportData): string {
  const { currency } = data;
  const m = (v: number) => esc(formatReportMoney(v, currency));
  const generated = format(new Date(data.generatedAt), "PPpp");

  const stat = (label: string, value: string, color = "#111827") => `
    <td style="padding:0 18px 0 0;vertical-align:top;">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${esc(label)}</div>
      <div style="font:700 22px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${color};">${value}</div>
    </td>`;

  const row = (left: string, sub: string, right: string) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">
        <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;">${esc(left)}</div>
        <div style="font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af;">${esc(sub)}</div>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font:600 14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#111827;white-space:nowrap;">${right}</td>
    </tr>`;

  const body = data.empty
    ? `<p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;">Nothing was recorded for ${esc(
        data.label,
      )} yet.</p>`
    : `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr>
        ${stat("Total spent", m(data.totals.expenses))}
        ${stat("Income", m(data.totals.income), "#047857")}
        ${stat("Net", `${data.totals.net >= 0 ? "+" : "−"}${m(Math.abs(data.totals.net))}`, data.totals.net >= 0 ? "#047857" : "#b91c1c")}
        ${stat("Net worth", m(data.netWorthCurrent))}
      </tr></table>

      <h2 style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#374151;margin:0 0 6px;">Top vendors</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
        ${data.topVendors
          .map((v) => row(v.vendor, `${v.count} transaction${v.count === 1 ? "" : "s"}`, m(v.total)))
          .join("")}
      </table>

      <h2 style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#374151;margin:0 0 6px;">Biggest purchases</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
        ${data.biggest
          .map((b) => row(b.vendor, `${b.categoryName} · ${format(new Date(b.date + "T00:00:00"), "MMM d")}`, m(b.amount)))
          .join("")}
      </table>

      <h2 style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#374151;margin:0 0 6px;">Where it went</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        ${data.categories
          .slice(0, 10)
          .map((c) => row(c.category, "", m(c.total)))
          .join("")}
      </table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>budgetr — ${esc(
    data.label,
  )}</title></head>
<body style="margin:0;background:#f6f5f2;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eae7e0;border-radius:14px;">
    <tr><td style="padding:28px 32px;">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a08a4b;">budgetr · ${esc(
        REPORT_PERIOD_LABELS[data.period],
      )}</div>
      <h1 style="font:700 26px/1.2 Georgia,'Times New Roman',serif;color:#111827;margin:6px 0 2px;">${esc(
        data.label,
      )} in review</h1>
      <div style="font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af;margin:0 0 24px;">Generated ${esc(
        generated,
      )} · figures in ${esc(currency)}</div>
      ${body}
      <div style="margin:28px 0 0;padding-top:16px;border-top:1px solid #f0f0f0;font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#b0b0b0;">
        Sent by budgetr — your data stays on your machine.
      </div>
    </td></tr>
  </table>
</body></html>`;
}
