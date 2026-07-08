/**
 * Display-grade probability & expected-move analytics for option structures.
 *
 * These sit on top of the exact expiry-payoff engine (`analyzePayoff`) and add
 * the forward-looking, model-based numbers OptionStrat-style tools surface:
 * probability of profit and the 1σ expected move. Both assume terminal prices
 * are lognormal and driftless (forward = spot) — the common convention for
 * "probability of profit" so the number doesn't bake in a directional view. All
 * of it is approximate and only as good as the implied vol we feed it, so the UI
 * labels it as an estimate.
 *
 * Pure module (no DB / network); safe in client components.
 */

import { normCdf } from "./greeks";
import { payoffAtExpiry, type PayoffAnalysis, type PayoffLeg } from "./payoff";

/**
 * P(S_T < K) under a driftless lognormal terminal distribution:
 *   ln S_T ~ N(ln S0 − ½σ²T, σ²T)   (so E[S_T] = S0, no drift baked in).
 */
function probBelow(K: number, S0: number, sigma: number, T: number): number {
  if (K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const z = (Math.log(K / S0) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return normCdf(z);
}

/**
 * Probability the position finishes profitable at expiry, integrating the
 * lognormal terminal density over the price regions where the payoff is > 0.
 * Because the payoff is piecewise-linear with kinks at the strikes and zeros at
 * the breakevens, the profitable set is a union of intervals bounded by those
 * breakevens (and 0 / ∞ at the ends); we sum the lognormal mass over them.
 *
 * Returns null when we can't model it (no positive IV, no spot, expired, or no
 * finite economics). `sigma` is decimal IV (0.42), `T` is years to expiry.
 */
export function probabilityOfProfit(
  legs: PayoffLeg[],
  analysis: PayoffAnalysis,
  spot: number | null | undefined,
  sigma: number | null | undefined,
  T: number,
): number | null {
  if (
    spot == null ||
    !(spot > 0) ||
    sigma == null ||
    !(sigma > 0) ||
    !(T > 0) ||
    (analysis.maxProfit == null && !analysis.maxProfitUnbounded)
  ) {
    return null;
  }

  // Boundaries: 0, each breakeven, +∞. Sample each open interval's midpoint to
  // decide if it's profitable, then add its lognormal probability mass.
  const bes = analysis.breakevens.filter((b) => b > 0).sort((a, b) => a - b);
  const bounds = [0, ...bes, Infinity];
  let pop = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    const mid = hi === Infinity ? lo + Math.max(lo, spot) : (lo + hi) / 2;
    if (payoffAtExpiry(legs, mid) > 0) {
      const pLo = lo <= 0 ? 0 : probBelow(lo, spot, sigma, T);
      const pHi = hi === Infinity ? 1 : probBelow(hi, spot, sigma, T);
      pop += pHi - pLo;
    }
  }
  return Math.min(1, Math.max(0, pop));
}

/** ±1σ expected move in dollars at horizon `T` (years): spot · σ · √T. */
export function expectedMove(
  spot: number | null | undefined,
  sigma: number | null | undefined,
  T: number,
): number | null {
  if (spot == null || !(spot > 0) || sigma == null || !(sigma > 0) || !(T > 0)) return null;
  return spot * sigma * Math.sqrt(T);
}
