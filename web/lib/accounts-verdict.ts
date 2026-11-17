/**
 * The sentence under the Accounts hero. Net worth alone hides its own makeup —
 * the same figure can be all cash or a large balance propped against a large
 * debt — so the line says how much of what you hold is owed back.
 *
 * Pure; amounts come back raw and are formatted at the call site.
 */

import type { StatementVerdict } from "./transactions-verdict";

const EPS = 0.005;

export function accountsVerdict({
  count,
  assets,
  liabilities,
}: {
  /** Accounts counted in the net (hidden ones excluded). */
  count: number;
  /** Sum of non-liability balances, display currency. */
  assets: number;
  /** Sum owed on credit and loan accounts, display currency. Positive when owed. */
  liabilities: number;
}): StatementVerdict | null {
  if (count <= 0) return null;

  const net = assets - liabilities;
  if (net < -EPS) {
    return { tone: "coral", lead: "You owe", amount: -net, tail: "more than you hold." };
  }
  if (liabilities <= EPS) {
    return { tone: "jade", lead: "Nothing is owed against it.", amount: null, tail: "" };
  }
  return {
    tone: "brass",
    lead: "That is after",
    amount: liabilities,
    tail: "owed on credit and loans.",
  };
}
