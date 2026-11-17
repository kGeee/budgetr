/**
 * The sentence under the Income & gains hero.
 *
 * The hero already prints the net figure, so the sentence says what the figure
 * hides: how it splits between long- and short-term, and whether any loss in it
 * is disallowed as a wash sale. Pure — no clock, no money formatting; the wash
 * `amount` is formatted at the call site so privacy mode and the display
 * currency are honoured.
 */

export type RealizedSplitVerdict = {
  /** A whole sentence about the long/short split. */
  split: string;
  /** The wash-sale clause, or null when nothing is disallowed. */
  wash: { lead: string; amount: number; tail: string } | null;
};

const EPS = 0.005;

function splitSentence(longTerm: number, shortTerm: number): string {
  const total = longTerm + shortTerm;
  const hasLong = Math.abs(longTerm) >= EPS;
  const hasShort = Math.abs(shortTerm) >= EPS;
  if (!hasLong && !hasShort) return "Gains and losses cancel out.";
  if (!hasShort) return longTerm > 0 ? "All of it is long-term." : "All of the loss is long-term.";
  if (!hasLong) return shortTerm > 0 ? "All of it is short-term." : "All of the loss is short-term.";

  // Same direction: one share describes the whole.
  if (longTerm > 0 && shortTerm > 0) {
    return `${Math.round((longTerm / total) * 100)}% of it is long-term.`;
  }
  if (longTerm < 0 && shortTerm < 0) {
    return `${Math.round((shortTerm / total) * 100)}% of the loss is short-term.`;
  }
  // Opposite directions: a percentage of the net would exceed 100 and mean nothing.
  return longTerm > 0
    ? "Long-term lots gained while short-term lots lost."
    : "Short-term lots gained while long-term lots lost.";
}

/**
 * @param longTerm   net long-term gain over the lots on screen
 * @param shortTerm  net short-term gain over the same lots
 * @param washLots   the wash-sale lots that closed at a loss: ticker + positive loss
 */
export function realizedSplitVerdict({
  longTerm,
  shortTerm,
  washLots,
}: {
  longTerm: number;
  shortTerm: number;
  washLots: { ticker: string; loss: number }[];
}): RealizedSplitVerdict {
  const losses = washLots.filter((w) => w.loss >= EPS);
  const amount = losses.reduce((a, w) => a + w.loss, 0);
  let wash: RealizedSplitVerdict["wash"] = null;
  if (losses.length === 1) {
    wash = {
      lead: `One ${losses[0].ticker} loss of`,
      amount,
      tail: "is disallowed as a wash sale.",
    };
  } else if (losses.length > 1) {
    wash = {
      lead: `${losses.length} losses totalling`,
      amount,
      tail: "are disallowed as wash sales.",
    };
  }
  return { split: splitSentence(longTerm, shortTerm), wash };
}

/** Widths (percent) for the long/short bar, by magnitude so a loss still shows. */
export function splitBarShares(longTerm: number, shortTerm: number): { long: number; short: number } {
  const l = Math.abs(longTerm);
  const s = Math.abs(shortTerm);
  const sum = l + s;
  if (sum < EPS) return { long: 0, short: 0 };
  return { long: (l / sum) * 100, short: (s / sum) * 100 };
}
