/**
 * Accounts grouped by what the money is, not by who holds it.
 *
 * The Accounts page used to be one card per institution, which answers "where
 * is it" but makes "how much cash do I have" a sum across cards. The statement
 * layout reads the other way round: Cash, Investments, Cards, Loans — with the
 * institution demoted to a provenance column on each row.
 *
 * Pure: takes rows that already carry a display-currency value, so the grouping
 * and the subtotals are testable without a database or an FX table.
 */

export type AccountKind = "cash" | "investments" | "cards" | "loans" | "other";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: "Cash",
  investments: "Investments",
  cards: "Cards",
  loans: "Loans",
  other: "Other",
};

/** Reading order. The first four always show; "other" only when it has rows. */
export const ACCOUNT_KIND_ORDER: AccountKind[] = ["cash", "investments", "cards", "loans", "other"];

const KIND_BY_TYPE: Record<string, AccountKind> = {
  depository: "cash",
  investment: "investments",
  credit: "cards",
  loan: "loans",
};

export function accountKind(type: string): AccountKind {
  return KIND_BY_TYPE[type] ?? "other";
}

export type AccountGroup<T> = {
  kind: AccountKind;
  label: string;
  /** True for cards and loans: balances there are owed, and subtotal is ≤ 0. */
  owed: boolean;
  rows: T[];
  /** Signed sum of the rows that count (hidden ones left out). */
  subtotal: number;
  hiddenCount: number;
};

/**
 * Bucket accounts into the five kinds, in reading order.
 *
 * `signedValue` must already be signed (a liability negative) and converted to
 * the display currency. Rows keep their incoming order inside a group, except
 * that hidden accounts sink to the bottom — they are still listed so they can
 * be un-hidden, but they should not sit between two that count.
 */
export function groupAccountsByKind<T extends { type: string; excluded: boolean }>(
  rows: T[],
  signedValue: (row: T) => number,
): AccountGroup<T>[] {
  const buckets = new Map<AccountKind, T[]>(ACCOUNT_KIND_ORDER.map((k) => [k, []]));
  for (const row of rows) buckets.get(accountKind(row.type))!.push(row);

  const groups: AccountGroup<T>[] = [];
  for (const kind of ACCOUNT_KIND_ORDER) {
    const all = buckets.get(kind)!;
    if (kind === "other" && all.length === 0) continue;
    const counted = all.filter((r) => !r.excluded);
    const hidden = all.filter((r) => r.excluded);
    groups.push({
      kind,
      label: ACCOUNT_KIND_LABEL[kind],
      owed: kind === "cards" || kind === "loans",
      rows: [...counted, ...hidden],
      subtotal: counted.reduce((s, r) => s + signedValue(r), 0),
      hiddenCount: hidden.length,
    });
  }
  return groups;
}
