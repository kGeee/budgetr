/**
 * The sentence under the Spending hero. The hero states what went out; this
 * reads it against what came in over the same period — the two numbers the
 * page already shows as "Income" and "Net".
 *
 * Pure, following lib/budget-verdict.ts: the amount is formatted at the call
 * site so privacy mode and the display currency are honoured.
 */

export type SpendingVerdict = {
  tone: "jade" | "coral" | "muted";
  /** Words before the figure. */
  lead: string;
  /** The amount the sentence turns on — format it at the call site. */
  amount: number;
  /** Words after the figure, including the full stop. */
  tail: string;
};

export function spendingVerdict({
  income,
  expenses,
  txCount,
}: {
  income: number;
  expenses: number;
  txCount: number;
}): SpendingVerdict | null {
  if (txCount === 0) return null;

  // Nothing came in, so there is no share to state — only where it came from.
  if (!(income > 0.005)) {
    if (!(expenses > 0.005)) return null;
    return {
      tone: "muted",
      lead: "No income was recorded, so all",
      amount: expenses,
      tail: "came out of what you already had.",
    };
  }

  const net = income - expenses;
  if (net >= 0) {
    const share = Math.round((net / income) * 100);
    return {
      tone: "jade",
      lead: "You kept",
      amount: net,
      tail: `of what came in — ${share}% of income.`,
    };
  }
  return { tone: "coral", lead: "You spent", amount: -net, tail: "more than came in." };
}
