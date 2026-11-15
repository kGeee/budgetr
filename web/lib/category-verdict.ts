/**
 * The sentence over a category's twelve-month chart: where the latest month
 * stands against what the category usually costs. Pure — amounts are formatted
 * at the call site so privacy mode and the display currency are honoured.
 */

export type CategoryMonthPoint = { month: string; amount: number };

export type CategoryVerdict = {
  /** The newest month in the series, `YYYY-MM`. */
  month: string;
  /** That month's amount. */
  current: number;
  /** Mean of the earlier months, or null when there are none to compare to. */
  usual: number | null;
  /** Sum over every month in the series. */
  total: number;
  /** Mean over every month in the series. */
  average: number;
  tone: "jade" | "brass" | "muted";
};

/** @param months any order; one point per month that had activity. */
export function categoryVerdict(months: CategoryMonthPoint[]): CategoryVerdict | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted[sorted.length - 1];
  const earlier = sorted.slice(0, -1);
  const total = sorted.reduce((s, m) => s + m.amount, 0);
  const usual =
    earlier.length > 0 ? earlier.reduce((s, m) => s + m.amount, 0) / earlier.length : null;
  // Within 5% of the usual month is the usual month.
  const tone =
    usual == null || usual <= 0
      ? "muted"
      : latest.amount > usual * 1.05
        ? "brass"
        : "jade";
  return {
    month: latest.month,
    current: latest.amount,
    usual,
    total,
    average: total / sorted.length,
    tone,
  };
}
