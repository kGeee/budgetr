/**
 * Whole-cent allocation, shared by every splitter.
 *
 * Lives in core rather than in either client because the desktop and the phone
 * must round the same way — two devices showing the same bill a cent apart is
 * the kind of bug nobody reports and everybody stops trusting.
 */

/**
 * Distribute `totalCents` across `weights` so the parts are whole cents that sum
 * to exactly `totalCents` — floor each part, then hand the leftover cents out
 * one at a time to the largest fractional remainders (largest-remainder method).
 * Ties break toward the earlier participant, so the result is deterministic.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / totalWeight);
  const floors = exact.map(Math.floor);
  let leftover = totalCents - floors.reduce((a, n) => a + n, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; leftover > 0; k++, leftover--) out[order[k % order.length]!.i]!++;
  return out;
}
