/**
 * Recurring-stream date projection (pure, no DB).
 *
 * Plaid stores a single `predicted_next_date` per recurring stream, which goes
 * stale the moment it passes and never captures a cadence that lands more than
 * once a month. These helpers roll a stream's anchor forward by its frequency to
 * enumerate every occurrence inside a window — the basis of the cashflow forecast
 * (lib/forecast.ts). Kept dependency-free so it stays deterministic and unit-tested.
 */

import { addDays, addMonths, addWeeks, addYears, format, parseISO } from "date-fns";

/** Advance a date by one period of `frequency`, or null for non-repeating streams. */
export function stepDate(d: Date, frequency: string | null): Date | null {
  switch ((frequency ?? "").toUpperCase()) {
    case "WEEKLY":
      return addWeeks(d, 1);
    case "BIWEEKLY":
      return addWeeks(d, 2);
    case "SEMI_MONTHLY":
      return addDays(d, 15); // Plaid's twice-a-month cadence, approximated
    case "MONTHLY":
      return addMonths(d, 1);
    case "ANNUALLY":
      return addYears(d, 1);
    default:
      return null; // UNKNOWN / null → a single, non-repeating dated event
  }
}

/**
 * The dates (YYYY-MM-DD, inclusive) a stream is predicted to land within
 * [from, to], rolling its stored prediction forward by frequency. A stale anchor
 * (already past) advances to the next real occurrence, and multi-per-month
 * cadences are emitted every time they land — so a biweekly paycheck shows twice.
 */
export function streamOccurrences(
  anchorISO: string,
  frequency: string | null,
  from: string,
  to: string,
): string[] {
  if (from > to) return [];
  let d = parseISO(anchorISO);

  // Non-repeating streams: just the single dated event, if it's in the window.
  if (stepDate(d, frequency) === null) {
    return anchorISO >= from && anchorISO <= to ? [anchorISO] : [];
  }

  // Roll forward to the first occurrence on/after `from` (guarded against loops).
  let guard = 0;
  while (format(d, "yyyy-MM-dd") < from && guard++ < 800) {
    const next = stepDate(d, frequency);
    if (!next) break;
    d = next;
  }

  const out: string[] = [];
  guard = 0;
  while (format(d, "yyyy-MM-dd") <= to && guard++ < 62) {
    out.push(format(d, "yyyy-MM-dd"));
    const next = stepDate(d, frequency);
    if (!next) break;
    d = next;
  }
  return out;
}
