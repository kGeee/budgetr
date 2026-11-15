/**
 * Sentences and small derived figures for the Plan tabs that the hero-and-rule
 * layout needs and the queries don't return: what share of the monthly
 * commitment the largest bill is, how a due date reads relative to today, and
 * the Coast-FIRE sentence under the Long run figure.
 *
 * Pure and date-injected, following lib/budget-verdict.ts — amounts are
 * returned raw and formatted at the call site.
 */

import { monthlyEquivalent } from "./recurring";

type Stream = { frequency: string | null; averageAmount: number | null };

export type CommitmentLead<T> = {
  /** The stream with the largest monthly equivalent. */
  row: T;
  /** Its monthly equivalent. */
  monthly: number;
  /** Its share of `total`, in [0, 1]. */
  share: number;
};

/**
 * The stream that dominates the monthly commitment, measured the same way the
 * headline is (monthly equivalents — a yearly $1,200 bill is $100 here, not
 * $1,200). Null when nothing normalisable is in the total.
 */
export function commitmentLead<T extends Stream>(rows: T[], total: number): CommitmentLead<T> | null {
  if (!(total > 0)) return null;
  let best: CommitmentLead<T> | null = null;
  for (const row of rows) {
    const monthly = monthlyEquivalent(row);
    if (monthly == null || monthly <= 0) continue;
    if (!best || monthly > best.monthly) {
      best = { row, monthly, share: Math.min(1, monthly / total) };
    }
  }
  return best;
}

/** Whole days from `today` to `date` (negative when it has passed). */
export function daysUntil(date: string, today: string): number | null {
  const a = Date.parse(`${today}T00:00:00`);
  const b = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "due today", "due tomorrow", "due in 3 days" — empty for a past or bad date. */
export function dueIn(date: string | null, today: string): string {
  if (!date) return "";
  const n = daysUntil(date, today);
  if (n == null || n < 0) return "";
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  return `due in ${n} days`;
}

/** Fractional years as the hero figure: one decimal, e.g. "15.6". */
export function yearsFigure(years: number): string {
  return years.toFixed(1);
}

const CADENCE: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  ANNUALLY: "Yearly",
  UNKNOWN: "Irregular",
};

/** Plaid's stream frequency in words. */
export function cadenceLabel(frequency: string | null): string {
  return (frequency && CADENCE[frequency]) ?? "Recurring";
}
