/**
 * The sentences under the Transactions heroes. Both views used to open with a
 * run of muted prose; these read the same totals back as one line: what went
 * out against what came in (All), and how much money is sitting unconfirmed
 * (Needs review).
 *
 * Pure — amounts are returned raw and formatted at the call site so privacy
 * mode and the display currency are honoured.
 */

export type StatementVerdict = {
  tone: "jade" | "brass" | "coral" | "muted";
  /** Words before the figure — or the whole sentence when `amount` is null. */
  lead: string;
  /** The amount the sentence turns on; null when the sentence has no figure. */
  amount: number | null;
  /** Words after the figure, including the full stop. Empty without a figure. */
  tail: string;
};

const EPS = 0.005;
const say = (lead: string, tone: StatementVerdict["tone"] = "muted"): StatementVerdict => ({
  tone,
  lead,
  amount: null,
  tail: "",
});

/** All view: the hero is what went out; this sets it against what came in. */
export function ledgerVerdict({
  total,
  spent,
  received,
  filtered,
}: {
  /** Every entry matching the criteria. */
  total: number;
  spent: number;
  received: number;
  /** Whether any filter is applied — only changes the empty wording. */
  filtered: boolean;
}): StatementVerdict {
  if (total <= 0) return say(filtered ? "Nothing matches these filters." : "No transactions yet.");

  const out = spent > EPS;
  const inn = received > EPS;
  if (!out && !inn) return say("Nothing here counts as spending or income.");
  if (!out) return { tone: "jade", lead: "Nothing went out, and", amount: received, tail: "came in." };
  if (!inn) return say("Nothing came in against it.");

  const gap = received - spent;
  if (Math.abs(gap) <= EPS) return say("Money in and money out are level.");
  return gap > 0
    ? { tone: "jade", lead: "That is", amount: gap, tail: "less than came in." }
    : { tone: "brass", lead: "That is", amount: -gap, tail: "more than came in." };
}

/**
 * Needs-review view: the hero is the backlog count; this says what the loaded
 * rows are worth, so a long queue of small charges reads differently from a
 * short queue of large ones.
 */
export function reviewVerdict({
  total,
  loaded,
  out,
  in: inn,
}: {
  /** The whole backlog. */
  total: number;
  /** Rows actually on the page (the inbox loads a page at a time). */
  loaded: number;
  /** Outflow across the loaded rows. Positive. */
  out: number;
  /** Inflow across the loaded rows. Positive. */
  in: number;
}): StatementVerdict {
  if (total <= 0) {
    return say("All caught up — every settled transaction has been reviewed.", "jade");
  }
  const subject =
    loaded < total
      ? `The ${loaded.toLocaleString("en-US")} most recent carry`
      : total === 1
        ? "It carries"
        : "Together they carry";
  if (out > EPS) return { tone: "brass", lead: subject, amount: out, tail: "of unconfirmed spending." };
  if (inn > EPS) return { tone: "jade", lead: subject, amount: inn, tail: "of unconfirmed income." };
  return say(total === 1 ? "It moves no money." : "None of them moves any money.");
}
