/**
 * Verdict sentences for the two "how far along" summaries: the FIRE number on
 * Plan → Long run and the savings goals under Budgets. Both read a balance
 * against a target, so they share a shape: how much is still missing, and how
 * far along that puts you.
 *
 * Pure, following lib/budget-verdict.ts — format `amount` at the call site.
 */

export type ProgressVerdict = {
  tone: "jade" | "brass";
  lead: string;
  amount: number;
  /** Words after the figure, including the full stop. */
  tail: string;
};

const pct = (fraction: number) => `${Math.floor(Math.max(0, fraction) * 100)}%`;

/** Null until there is a FIRE number to measure against. */
export function fireVerdict({
  netWorth,
  fireNumber,
}: {
  netWorth: number;
  fireNumber: number;
}): ProgressVerdict | null {
  if (!(fireNumber > 0)) return null;
  const gap = fireNumber - netWorth;
  if (gap <= 0) {
    return {
      tone: "jade",
      lead: "You are",
      amount: -gap,
      tail: "past your FIRE number — congratulations.",
    };
  }
  return {
    tone: "brass",
    lead: "You are",
    amount: gap,
    tail: `short of financial independence, ${pct(netWorth / fireNumber)} of the way there.`,
  };
}

/** Null until at least one active goal has a target. */
export function goalsVerdict({
  totalSaved,
  totalTarget,
  count,
}: {
  totalSaved: number;
  totalTarget: number;
  /** Active (non-archived) goals. */
  count: number;
}): ProgressVerdict | null {
  if (!(totalTarget > 0)) return null;
  const goals = `${count} goal${count === 1 ? "" : "s"}`;
  const gap = totalTarget - totalSaved;
  if (gap <= 0.005) {
    return {
      tone: "jade",
      lead: "You have set aside",
      amount: totalSaved,
      tail: `across ${goals} — the combined target is met.`,
    };
  }
  return {
    tone: "brass",
    lead: "You are",
    amount: gap,
    tail: `short of fully funding ${goals}, ${pct(totalSaved / totalTarget)} of the way there.`,
  };
}
