import { db } from "@/db";
import { fireSettings, netWorthMilestones } from "@/db/schema";
import type { FireSettings, NetWorthMilestone } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { getMonthlyCashflow, getNetWorth, getNetWorthSeries } from "@/lib/queries";

/**
 * FIRE (Financial Independence / Retire Early) tracking. All reads are
 * synchronous (better-sqlite3) and derived from existing net-worth, account, and
 * cashflow data plus the single-row `fire_settings` assumptions. Nothing here is
 * cached — pages are `force-dynamic` — so tweaking a setting or syncing new
 * transactions immediately re-derives every metric below.
 */

/** The assumptions a fresh install starts from, before the user tunes anything. */
const DEFAULT_SETTINGS: FireSettings = {
  id: "default",
  annualExpenses: null,
  safeWithdrawalRate: 4,
  expectedReturn: 7,
  monthlyContribution: null,
  targetRetirementAge: null,
  updatedAt: new Date(0),
};

/** How many months of recent cashflow to average income/expenses over. */
const CASHFLOW_WINDOW = 6;

/** Read the single settings row, falling back to sane defaults when absent. */
export function getFireSettings(): FireSettings {
  const row = db
    .select()
    .from(fireSettings)
    .where(sql`${fireSettings.id} = 'default'`)
    .get();
  return row ?? DEFAULT_SETTINGS;
}

/** Net-worth milestones ordered by the user's sort order, then ascending target. */
export function getMilestones(): NetWorthMilestone[] {
  return db
    .select()
    .from(netWorthMilestones)
    .orderBy(asc(netWorthMilestones.sortOrder), asc(netWorthMilestones.amount))
    .all();
}

/**
 * Sum of liquid assets — depository (cash) + investment account balances. This
 * is the pool that actually funds early retirement / runway, so it deliberately
 * excludes illiquid manual holdings and treats liabilities separately (net worth
 * already nets those out).
 */
function getLiquidAssets(): number {
  const row = db.get<{ v: number }>(sql`
    SELECT COALESCE(SUM(current_balance), 0) AS v
    FROM accounts
    WHERE type IN ('depository', 'investment')`);
  return Number(row?.v ?? 0);
}

export type MilestoneProgress = NetWorthMilestone & {
  /** Progress toward this milestone in [0, 100]. */
  pct: number;
  /** True once live net worth meets the target (regardless of achievedDate). */
  reached: boolean;
};

export type FireMetrics = {
  /** Current total net worth (assets − liabilities). */
  netWorth: number;
  /** Liquid assets: depository + investment balances. */
  liquidAssets: number;
  /** Average monthly income over the cashflow window. */
  avgMonthlyIncome: number;
  /** Average monthly expenses over the cashflow window. */
  avgMonthlyExpenses: number;
  /** (income − expenses) / income, clamped to [0, 1]; null when no income. */
  savingsRate: number | null;
  /** Annual expenses used for the FIRE number (setting or derived). */
  annualExpenses: number;
  /** True when annualExpenses was derived from cashflow rather than user-set. */
  annualExpensesDerived: boolean;
  /** Months of expenses covered by liquid assets; null when expenses are zero. */
  runwayMonths: number | null;
  /** The nest egg that sustains annualExpenses at the safe-withdrawal rate. */
  fireNumber: number;
  /** netWorth / fireNumber in [0, 1]; null when the FIRE number is unknown. */
  fireProgress: number | null;
  /** Monthly contribution assumed for the projection (setting or derived). */
  monthlyContribution: number;
  /** True when monthlyContribution was derived from savings rather than user-set. */
  monthlyContributionDerived: boolean;
  /** Whole + fractional years until net worth compounds to the FIRE number. */
  yearsToFire: number | null;
  /** 'YYYY-MM-DD' the projection crosses the FIRE number, or null if unreachable. */
  coastFireDate: string | null;
  /** Settings echoed back for the editor. */
  settings: FireSettings;
  /** Milestones with live progress. */
  milestones: MilestoneProgress[];
};

/**
 * Project a starting balance forward month by month, compounding at
 * `annualReturn` (whole %) and adding `monthlyContribution` each month, until it
 * reaches `target`. Returns the fractional number of years, or null if it never
 * gets there within `capYears` (e.g. no growth and no contributions).
 */
function yearsUntil(
  start: number,
  target: number,
  annualReturn: number,
  monthlyContribution: number,
  capYears = 100,
): number | null {
  if (start >= target) return 0;
  const monthlyRate = annualReturn / 100 / 12;
  let balance = start;
  const capMonths = capYears * 12;
  for (let m = 1; m <= capMonths; m++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    if (balance >= target) return m / 12;
  }
  return null;
}

/** Add `years` (fractional) to today and return the 'YYYY-MM-DD' date. */
function dateInYears(years: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

/**
 * Everything the FIRE dashboard renders, computed in one pass: savings rate from
 * recent cashflow, runway from liquid assets, the FIRE number from annual
 * expenses ÷ safe-withdrawal-rate, the compounding projection to that number,
 * and milestone progress against live net worth.
 */
export function getFireMetrics(): FireMetrics {
  const settings = getFireSettings();
  const { net: netWorth } = getNetWorth();
  const liquidAssets = getLiquidAssets();

  // Average monthly income/expenses over the recent cashflow window.
  const cashflow = getMonthlyCashflow(CASHFLOW_WINDOW);
  const n = cashflow.length;
  const avgMonthlyIncome = n > 0 ? cashflow.reduce((s, m) => s + m.income, 0) / n : 0;
  const avgMonthlyExpenses = n > 0 ? cashflow.reduce((s, m) => s + m.expenses, 0) / n : 0;

  const savingsRate =
    avgMonthlyIncome > 0
      ? Math.max(0, Math.min(1, (avgMonthlyIncome - avgMonthlyExpenses) / avgMonthlyIncome))
      : null;

  // Annual expenses: user setting wins, else derive from the cashflow average.
  const annualExpensesDerived =
    settings.annualExpenses == null || settings.annualExpenses <= 0;
  const annualExpenses = annualExpensesDerived
    ? avgMonthlyExpenses * 12
    : settings.annualExpenses!;

  const monthlyExpenses = annualExpenses / 12;
  const runwayMonths = monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : null;

  const swr = settings.safeWithdrawalRate > 0 ? settings.safeWithdrawalRate : 4;
  const fireNumber = annualExpenses > 0 ? annualExpenses / (swr / 100) : 0;
  const fireProgress =
    fireNumber > 0 ? Math.max(0, Math.min(1, netWorth / fireNumber)) : null;

  // Monthly contribution: user setting wins, else derive from recent savings.
  const derivedContribution = Math.max(0, avgMonthlyIncome - avgMonthlyExpenses);
  const monthlyContributionDerived =
    settings.monthlyContribution == null || settings.monthlyContribution < 0;
  const monthlyContribution = monthlyContributionDerived
    ? derivedContribution
    : settings.monthlyContribution!;

  let yearsToFire: number | null = null;
  let coastFireDate: string | null = null;
  if (fireNumber > 0) {
    yearsToFire = yearsUntil(
      Math.max(0, netWorth),
      fireNumber,
      settings.expectedReturn,
      monthlyContribution,
    );
    if (yearsToFire != null) coastFireDate = dateInYears(yearsToFire);
  }

  const milestones: MilestoneProgress[] = getMilestones().map((m) => ({
    ...m,
    pct: m.amount > 0 ? Math.max(0, Math.min(100, (netWorth / m.amount) * 100)) : 0,
    reached: netWorth >= m.amount,
  }));

  return {
    netWorth,
    liquidAssets,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    savingsRate,
    annualExpenses,
    annualExpensesDerived,
    runwayMonths,
    fireNumber,
    fireProgress,
    monthlyContribution,
    monthlyContributionDerived,
    yearsToFire,
    coastFireDate,
    settings,
    milestones,
  };
}

export type FireProjectionPoint = {
  date: string; // YYYY-MM-DD (first of month)
  /** Historical net worth up to today, else null. */
  actual: number | null;
  /** Compounding projection from today forward, else null. Lines meet at today. */
  projected: number | null;
};

/**
 * A net-worth series for the projection chart: the historical `actual` line from
 * balance snapshots, then a monthly `projected` line compounding today's net
 * worth at the expected return (plus the monthly contribution annuity) until it
 * reaches the FIRE number or `maxYears` elapses. Both carry today's point so the
 * solid and dashed lines join. Degrades to just history when there's no growth.
 */
export function getFireProjectionSeries(maxYears = 40): FireProjectionPoint[] {
  const { netWorth, fireNumber, monthlyContribution, settings } = getFireMetrics();

  // Historical monthly net worth (last snapshot per month) as the `actual` line.
  const history = getNetWorthSeries();
  const byMonth = new Map<string, number>();
  for (const p of history) byMonth.set(p.date.slice(0, 7), p.netWorth);
  const points: FireProjectionPoint[] = [];
  for (const [month, nw] of byMonth) {
    points.push({ date: `${month}-01`, actual: nw, projected: null });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  // Anchor the projection at today's live net worth so the lines meet cleanly.
  const startDate = new Date();
  const startMonth = startDate.toISOString().slice(0, 7);
  const anchor = points.find((p) => p.date.slice(0, 7) === startMonth);
  if (anchor) anchor.projected = netWorth;
  else points.push({ date: `${startMonth}-01`, actual: netWorth, projected: netWorth });

  // Nothing to project toward (expenses/FIRE number unknown) — just show history.
  if (fireNumber <= 0) return points;

  const monthlyRate = settings.expectedReturn / 100 / 12;
  let balance = netWorth;
  const cursor = new Date(`${startMonth}-01T00:00:00`);
  for (let m = 1; m <= maxYears * 12; m++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    cursor.setMonth(cursor.getMonth() + 1);
    points.push({
      date: cursor.toISOString().slice(0, 10),
      actual: null,
      projected: balance,
    });
    // Stop once we've crossed the FIRE number (one point past it for context).
    if (fireNumber > 0 && balance >= fireNumber) break;
    // Bail on a flat projection (no growth, no contributions) to avoid a wall.
    if (monthlyRate === 0 && monthlyContribution === 0) break;
  }

  return points;
}
