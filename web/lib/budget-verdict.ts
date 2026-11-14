/**
 * The sentence under the Budgets hero. The page used to state the month's pace
 * only in a footer under the chart; this turns the same arithmetic into the
 * first thing read: are you under or ahead of an even burn, and by how much.
 *
 * Pure and date-injected so it can be tested without a clock.
 */

export type BudgetVerdict = {
  tone: "jade" | "brass" | "coral";
  /** Words before the figure. */
  lead: string;
  /** The amount the sentence turns on — format it at the call site. */
  amount: number;
  /** Words after the figure, including the full stop. */
  tail: string;
  /** Present only when the month is projected to finish over budget. */
  projectedOver?: number;
};

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * @param month       the month on screen, `YYYY-MM`
 * @param today       today's local date, `YYYY-MM-DD`
 */
export function budgetVerdict({
  month,
  today,
  totalBudget,
  totalSpent,
}: {
  month: string;
  today: string;
  totalBudget: number;
  totalSpent: number;
}): BudgetVerdict | null {
  if (!(totalBudget > 0)) return null;

  const total = daysIn(month);
  const current = today.slice(0, 7) === month;
  const day = current ? Math.min(total, Math.max(1, Number(today.slice(8, 10)))) : total;
  const left = total - day;
  const over = totalSpent - totalBudget;

  if (over > 0.005) {
    return {
      tone: "coral",
      lead: "You are",
      amount: over,
      tail: current && left > 0 ? `over budget with ${days(left)} left.` : "over budget.",
    };
  }

  // A month that has already closed has no pace — only a result.
  if (!current || left === 0) {
    return { tone: "jade", lead: "The month closed", amount: -over, tail: "under budget." };
  }

  const expected = (totalBudget * day) / total;
  const gap = expected - totalSpent;
  if (gap >= 0) {
    return {
      tone: "jade",
      lead: "Spending is",
      amount: gap,
      tail: `under an even pace, with ${days(left)} left.`,
    };
  }

  const projected = (totalSpent / day) * total;
  return {
    tone: "brass",
    lead: "Spending is",
    amount: -gap,
    tail: `ahead of an even pace, with ${days(left)} left.`,
    projectedOver: Math.max(0, projected - totalBudget),
  };
}
