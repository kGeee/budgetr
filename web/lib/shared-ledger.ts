/**
 * Read-only derivations for the Shared page's ruled tables.
 *
 * The schema stores what each person owes on each expense and what each person
 * has paid back in total — it never ties a repayment to a particular expense,
 * and it never records how a split was made. The page still wants to say
 * "Evenly, 3" and "Open", so both are worked out here, from the same rows the
 * page already loads. Pure, and typed structurally so it needs no database.
 */

const EPS = 0.01;

type Share = { personId: string; amount: number };

type ExpenseLike = {
  id: string;
  date: string;
  displayName: string;
  myShare: number;
  itemsJson: string | null;
  shares: Share[];
};

/**
 * How a split was made, as far as the stored numbers can say.
 *
 * A receipt split keeps its line items, so that one is certain. Otherwise equal
 * shares (to the cent — an even three-way split of $10 is 3.34/3.33/3.33) read
 * as "Evenly"; anything else is "Amounts". A percent split is stored as the
 * amounts it produced, so it is indistinguishable from one typed in by hand.
 */
export function splitMethodLabel(expense: Pick<ExpenseLike, "myShare" | "itemsJson" | "shares">): string {
  if (expense.itemsJson) return "By item";
  const parts = expense.shares.map((s) => Math.abs(s.amount));
  const mine = Math.abs(expense.myShare);
  if (mine > EPS) parts.push(mine);
  if (parts.length === 0) return "—";
  const lo = Math.min(...parts);
  const hi = Math.max(...parts);
  return hi - lo <= EPS + 1e-9 ? `Evenly, ${parts.length}` : "Amounts";
}

export type OpenItem = {
  expenseId: string;
  displayName: string;
  date: string;
  /** What this person still owes on this expense. Positive. */
  amount: number;
};

export type OpenLedger = {
  /** Still outstanding on each expense, summed across its people. 0 = repaid. */
  byExpense: Map<string, number>;
  /** Each person's unpaid shares, newest first. Empty/absent when square. */
  byPerson: Map<string, OpenItem[]>;
};

/**
 * Which shares are still unpaid, applying each person's repayments to their
 * oldest shares first.
 *
 * Equivalently: a person's outstanding balance sits on their *newest* shares.
 * Walking newest → oldest and stopping when the balance is used up gives the
 * same answer without needing every historical expense in hand — which matters
 * because the page loads a capped list while balances are lifetime totals.
 */
export function openLedger(
  expenses: ExpenseLike[],
  people: { id: string; balance: number }[],
): OpenLedger {
  const remaining = new Map<string, number>();
  for (const p of people) if (p.balance > EPS) remaining.set(p.id, p.balance);

  const byExpense = new Map<string, number>();
  const byPerson = new Map<string, OpenItem[]>();

  const newestFirst = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
  for (const e of newestFirst) {
    let open = 0;
    for (const s of e.shares) {
      const left = remaining.get(s.personId) ?? 0;
      const share = Math.abs(s.amount);
      if (left <= EPS || share <= EPS) continue;
      const amount = Math.min(share, left);
      remaining.set(s.personId, left - amount);
      open += amount;
      const list = byPerson.get(s.personId) ?? [];
      list.push({ expenseId: e.id, displayName: e.displayName, date: e.date, amount });
      byPerson.set(s.personId, list);
    }
    byExpense.set(e.id, open);
  }
  return { byExpense, byPerson };
}
