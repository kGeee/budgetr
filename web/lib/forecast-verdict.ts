/**
 * The sentence under the Plan → This month hero. The hero is where cash lands
 * at month-end; this says how far that is from where cash stands now, which is
 * the difference the stat strip (bills, income, pace spend) adds up to.
 *
 * Pure, following lib/budget-verdict.ts — format `amount` at the call site.
 */

export type ForecastVerdict = {
  tone: "jade" | "brass" | "coral" | "muted";
  lead: string;
  amount: number;
  /** Words after the figure, including the full stop. */
  tail: string;
};

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function forecastVerdict({
  currentCash,
  projectedEndBalance,
  daysRemaining,
}: {
  currentCash: number;
  projectedEndBalance: number;
  daysRemaining: number;
}): ForecastVerdict {
  const overdrawn = projectedEndBalance < 0;

  // A closed month has no projection left in it — only where it ended.
  if (daysRemaining <= 0) {
    return overdrawn
      ? { tone: "coral", lead: "The month closed", amount: -projectedEndBalance, tail: "overdrawn." }
      : { tone: "muted", lead: "The month closed with", amount: projectedEndBalance, tail: "in cash." };
  }

  const left = `with ${days(daysRemaining)} left.`;
  if (overdrawn) {
    return {
      tone: "coral",
      lead: "At this pace the month ends",
      amount: -projectedEndBalance,
      tail: `overdrawn, ${left}`,
    };
  }

  const change = projectedEndBalance - currentCash;
  if (Math.abs(change) < 0.005) {
    return { tone: "muted", lead: "Cash holds at", amount: currentCash, tail: `through month-end, ${left}` };
  }
  return change < 0
    ? { tone: "brass", lead: "Cash is set to fall by", amount: -change, tail: `by month-end, ${left}` }
    : { tone: "jade", lead: "Cash is set to grow by", amount: change, tail: `by month-end, ${left}` };
}
