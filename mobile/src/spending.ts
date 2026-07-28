// Month-to-date spending derivations for the Spending screen.
//
// The phone is not a calculator (spec T5) — but the Summary contract carries no
// per-category month total, so these are the minimum re-aggregations needed to
// render a category breakdown at all. Everything here re-slices numbers the
// desktop already sent; nothing invents a financial value:
//
//   · the month TOTAL comes from Summary.spendByDay, which the desktop derived
//   · a budgeted category's total is BudgetSummary.spentCents verbatim
//   · only unbudgeted categories are summed from Summary.recent, and that tape
//     is capped at MAX_RECENT_TXNS — so those totals are a floor, not a truth.
//     `partial` says so, and the UI labels them.
//
// Day math is UTC throughout, matching how the desktop stamps SparkPoint.d.

import type { BudgetSummary, CategoryInfo, SparkPoint, Summary, TxnSummary } from "@budgetr/core";

export interface MonthWindow {
  startSec: number; // unix seconds, 00:00 UTC on the 1st
  prevStartSec: number; // same, previous month
  dayOfMonth: number; // 1-based, clamped to the month's length
  daysInMonth: number;
  label: string; // "July"
}

export function monthWindow(now: Date = new Date()): MonthWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    startSec: Date.UTC(y, m, 1) / 1000,
    prevStartSec: Date.UTC(y, m - 1, 1) / 1000,
    dayOfMonth: Math.min(now.getUTCDate(), daysInMonth),
    daysInMonth,
    label: now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
  };
}

/** Day-of-month for a SparkPoint, 1-based. */
const domOf = (sec: number) => new Date(sec * 1000).getUTCDate();

/** Points falling inside [from, to). */
const between = (points: SparkPoint[], from: number, to: number) =>
  points.filter((p) => p.d >= from && p.d < to);

export interface MonthTotals {
  spentCents: number; // month to date
  priorCents: number; // same span of the previous month, for a like-for-like delta
  deltaPct: number | null; // null when there's no prior month to compare against
  cumulative: number[]; // running total, one entry per elapsed day
}

export function monthTotals(spendByDay: SparkPoint[], win: MonthWindow): MonthTotals {
  const thisMonth = between(spendByDay, win.startSec, win.startSec + 86_400 * 400);
  const byDay = new Map<number, number>();
  for (const p of thisMonth) byDay.set(domOf(p.d), (byDay.get(domOf(p.d)) ?? 0) + p.cents);

  const cumulative: number[] = [];
  let run = 0;
  for (let d = 1; d <= win.dayOfMonth; d++) {
    run += byDay.get(d) ?? 0;
    cumulative.push(run);
  }

  // Compare against the SAME slice of last month, not its full total — on the
  // 3rd, "vs last month" against a whole month would always read as a collapse.
  const prior = between(spendByDay, win.prevStartSec, win.startSec)
    .filter((p) => domOf(p.d) <= win.dayOfMonth)
    .reduce((a, p) => a + p.cents, 0);

  return {
    spentCents: run,
    priorCents: prior,
    deltaPct: prior > 0 ? ((run - prior) / prior) * 100 : null,
    cumulative,
  };
}

export interface CategorySpend {
  id: string;
  name: string;
  icon?: string;
  cents: number; // month to date
  budget: BudgetSummary | null;
  partial: boolean; // summed from the capped recent tape, so a floor
}

/** Spending categories only — income and transfers never count as spend. */
function isSpendCategory(info: CategoryInfo | undefined): boolean {
  return info === undefined || info.group === "spending";
}

/**
 * Month-to-date by category, descending. Budgeted categories use the desktop's
 * own spentCents; the rest are summed from the recent tape and flagged partial.
 */
export function categorySpend(
  summary: Summary | null,
  catIndex: Map<string, CategoryInfo>,
  win: MonthWindow,
): CategorySpend[] {
  if (!summary) return [];

  const budgets = new Map<string, BudgetSummary>();
  for (const b of summary.budgets) budgets.set(b.category, b);

  const fromTape = new Map<string, number>();
  for (const t of summary.recent) {
    if (t.ts < win.startSec || t.cents >= 0) continue; // outflows in this month only
    if (budgets.has(t.category)) continue; // the desktop's number wins
    if (!isSpendCategory(catIndex.get(t.category))) continue;
    fromTape.set(t.category, (fromTape.get(t.category) ?? 0) + Math.abs(t.cents));
  }

  const rows: CategorySpend[] = [];
  for (const [id, b] of budgets) {
    if (!isSpendCategory(catIndex.get(id))) continue;
    rows.push({
      id,
      name: catIndex.get(id)?.name ?? id,
      icon: catIndex.get(id)?.icon,
      cents: b.spentCents,
      budget: b,
      partial: false,
    });
  }
  for (const [id, cents] of fromTape) {
    rows.push({
      id,
      name: catIndex.get(id)?.name ?? id,
      icon: catIndex.get(id)?.icon,
      cents,
      budget: null,
      partial: true,
    });
  }

  return rows.filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}

/** This month's transactions for one category, newest first. */
export function categoryTxns(summary: Summary | null, categoryId: string, win: MonthWindow): TxnSummary[] {
  return (summary?.recent ?? [])
    .filter((t) => t.category === categoryId && t.cents < 0 && t.ts >= win.startSec)
    .sort((a, b) => b.ts - a.ts);
}

/**
 * Per-day outflow for one category across the month, as SparkPoints on the days
 * that have any. Drawn from the recent tape, so it shares its cap.
 */
export function categoryByDay(txns: TxnSummary[]): SparkPoint[] {
  const byDay = new Map<number, number>();
  for (const t of txns) {
    const day = Math.floor(t.ts / 86_400) * 86_400;
    byDay.set(day, (byDay.get(day) ?? 0) + Math.abs(t.cents));
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, cents]) => ({ d, cents }));
}

/**
 * Donut slices: the named categories plus whatever the month total exceeds
 * them. Without the remainder the ring would silently overstate each slice.
 */
export function mixSlices(rows: CategorySpend[], totalCents: number, max = 6) {
  const head = rows.slice(0, max);
  const named = head.reduce((a, r) => a + r.cents, 0);
  const rest = Math.max(0, totalCents - named);
  return rest > 0 ? [...head, { id: "__rest", name: "Everything else", cents: rest }] : head;
}
