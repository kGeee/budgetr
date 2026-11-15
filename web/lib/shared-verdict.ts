/**
 * The sentence under the Shared hero ("Owed to you"). Says who the figure is
 * spread across, and the one thing that qualifies it: money you owe back, or
 * failing that how much of what you fronted has already returned.
 *
 * Pure; amounts come back raw and are formatted at the call site.
 */

import type { StatementVerdict } from "./transactions-verdict";

const EPS = 0.01;
const people = (n: number) => `${n} ${n === 1 ? "person owes" : "people owe"} you`;

export function sharedVerdict({
  peopleCount,
  owing,
  youOwe,
  returned,
}: {
  /** Everyone on the ledger, settled or not. */
  peopleCount: number;
  /** How many of them currently owe you. */
  owing: number;
  /** What you owe others. Positive. */
  youOwe: number;
  /** Lifetime repayments received. Positive. */
  returned: number;
}): StatementVerdict {
  if (peopleCount <= 0) {
    return {
      tone: "muted",
      lead: "Split a transaction from its detail panel to start tracking what friends owe you.",
      amount: null,
      tail: "",
    };
  }
  if (owing <= 0) {
    return youOwe > EPS
      ? { tone: "coral", lead: "Nobody owes you, and you owe", amount: youOwe, tail: "back." }
      : { tone: "jade", lead: "Everyone's square.", amount: null, tail: "" };
  }
  if (youOwe > EPS) {
    return { tone: "coral", lead: `${people(owing)}, and you owe`, amount: youOwe, tail: "back." };
  }
  if (returned > EPS) {
    return {
      tone: "jade",
      lead: `${people(owing)};`,
      amount: returned,
      tail: "of what you fronted has already come back.",
    };
  }
  return { tone: "muted", lead: `${people(owing)}.`, amount: null, tail: "" };
}
