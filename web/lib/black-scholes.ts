/**
 * Black-Scholes pricing + implied-vol solver — the "anything needed to
 * calculate it" behind fixed-strike vol. Used to back-solve IV from mid
 * prices when a chain source ships no IV for a contract. Pure functions,
 * no market-data opinions: rates and time are the caller's problem.
 *
 * Conventions: S spot, K strike, T years (ACT/365), sigma decimal vol,
 * r continuously-compounded risk-free rate, no dividend yield (q = 0 — at
 * our horizon the error is well under typical bid/ask noise).
 */

/** Standard normal CDF via Abramowitz–Stegun 7.1.26 (|ε| < 7.5e-8). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function bsPrice(
  right: "call" | "put",
  S: number,
  K: number,
  T: number,
  sigma: number,
  r = 0.04,
): number {
  if (T <= 0 || sigma <= 0) {
    // Expired / zero-vol degenerate case: intrinsic on the discounted strike.
    const intrinsic = right === "call" ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S;
    return Math.max(0, intrinsic);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (right === "call") return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Implied vol from a price, by bisection (robust against the flat vega tails
 * where Newton diverges). Returns null when the price sits outside no-arb
 * bounds or the solver can't bracket it in [0.5%, 500%].
 */
export function impliedVol(
  right: "call" | "put",
  price: number,
  S: number,
  K: number,
  T: number,
  r = 0.04,
): number | null {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const intrinsic = Math.max(0, right === "call" ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S);
  const upper = right === "call" ? S : K * Math.exp(-r * T);
  if (price <= intrinsic + 1e-10 || price >= upper - 1e-10) return null;

  let lo = 0.005;
  let hi = 5;
  if (bsPrice(right, S, K, T, lo, r) > price || bsPrice(right, S, K, T, hi, r) < price) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(right, S, K, T, mid, r) < price) lo = mid;
    else hi = mid;
  }
  const iv = (lo + hi) / 2;
  return Number.isFinite(iv) ? iv : null;
}
