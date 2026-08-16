/**
 * Recurring-stream arithmetic and triage.
 *
 * Two things the page couldn't say. It totalled mixed frequencies and labelled
 * the result "/ period", which isn't a unit — a weekly $20 and an annual $240
 * are the same yearly commitment and were being added as if interchangeable.
 * And a stream whose predicted date has passed rendered identically to one
 * that's coming up, so four bills sat showing "Next Jul 12" in August with
 * nothing marking them as unaccounted for.
 *
 * Pure, so both the normalisation factors and the overdue boundary are testable
 * without a database.
 */

import { cleanDescriptor } from "@/lib/display-names";
import type { RecurringRow } from "@/lib/queries";

/**
 * Payments per month for each Plaid frequency.
 *
 * Weekly and biweekly use 52/12 and 26/12 rather than 4 and 2: a "$20 weekly"
 * subscription costs $86.67 a month, not $80, and over a year that gap is a
 * fortnight's payments. UNKNOWN is deliberately absent — an irregular stream
 * has no monthly equivalent, and inventing one would quietly inflate the
 * headline commitment.
 */
const PER_MONTH: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  ANNUALLY: 1 / 12,
};

/**
 * What a stream costs per month, or null when its frequency can't be
 * normalised. Callers must surface the null case rather than coercing it to 0 —
 * an irregular stream is unknown, not free.
 */
export function monthlyEquivalent(row: {
  frequency: string | null;
  averageAmount: number | null;
}): number | null {
  const factor = row.frequency ? PER_MONTH[row.frequency] : undefined;
  if (factor === undefined) return null;
  return Math.abs(row.averageAmount ?? 0) * factor;
}

export type MonthlyTotal = {
  /** Sum of the normalisable streams. */
  total: number;
  /** Streams whose frequency has no monthly equivalent, and so aren't in it. */
  irregular: number;
};

export function monthlyCommitment(rows: RecurringRow[]): MonthlyTotal {
  let total = 0;
  let irregular = 0;
  for (const r of rows) {
    const m = monthlyEquivalent(r);
    if (m === null) irregular += 1;
    else total += m;
  }
  return { total, irregular };
}

export type DueSplit = {
  /** Predicted date has passed with no matching charge seen. */
  overdue: RecurringRow[];
  /** Due within `soonDays`. */
  soon: RecurringRow[];
  /** Everything else, including streams with no prediction at all. */
  later: RecurringRow[];
};

/**
 * Split streams by where their predicted date falls relative to today.
 *
 * "Overdue" here means *unconfirmed*, not *missed*: Plaid predicts the date and
 * budgetr can't see the charge until a sync brings it in, so a stale sync
 * produces overdue rows that are entirely expected. The page has to say that,
 * rather than implying a missed payment.
 */
export function splitByDue(
  rows: RecurringRow[],
  today: string,
  soonDays = 7,
): DueSplit {
  const horizon = addDays(today, soonDays);
  const split: DueSplit = { overdue: [], soon: [], later: [] };

  for (const r of rows) {
    const due = r.predictedNextDate;
    if (!due) split.later.push(r);
    else if (due < today) split.overdue.push(r);
    else if (due <= horizon) split.soon.push(r);
    else split.later.push(r);
  }

  const byDate = (a: RecurringRow, b: RecurringRow) =>
    (a.predictedNextDate ?? "9999").localeCompare(b.predictedNextDate ?? "9999");
  split.overdue.sort(byDate);
  split.soon.sort(byDate);
  split.later.sort(byDate);
  return split;
}

/** Whole days a predicted date is past `today`. Zero when it isn't. */
export function daysLate(predicted: string | null, today: string): number {
  if (!predicted || predicted >= today) return 0;
  const a = Date.parse(`${predicted}T00:00:00`);
  const b = Date.parse(`${today}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * The name to show for a stream.
 *
 * Plaid gives no merchant for some streams — including, in this ledger, the two
 * largest. A user-set label wins outright; otherwise fall back through the
 * descriptor to an explicit prompt, because "Unknown" invites nothing while a
 * blank-looking row on a $2,382/month bill is the single most valuable thing on
 * the page to fix.
 */
export function streamLabel(row: {
  userLabel?: string | null;
  merchantName: string | null;
  description: string | null;
}): { name: string; needsName: boolean } {
  const label = row.userLabel?.trim();
  if (label) return { name: label, needsName: false };
  const merchant = row.merchantName?.trim();
  if (merchant) return { name: merchant, needsName: false };
  // The descriptor is a settlement record, not a name — left raw it puts
  // "AMERICAN EXPRESS DES:ACH PMT ID:… INDN:KEVIN GEORGE …" in the largest
  // figure on the page, complete with the account holder's name. Same cleaner
  // the transaction rows use.
  const description = row.description?.trim();
  if (description) return { name: cleanDescriptor(description), needsName: true };
  return { name: "Unnamed stream", needsName: true };
}
