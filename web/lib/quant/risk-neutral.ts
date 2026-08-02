/**
 * Market-implied (risk-neutral) terminal-price density and scoring.
 *
 * WHY: the strategy panel previously scored positions against a SINGLE flat
 * ATM-vol lognormal, while the legs are priced from the real vol smile. Those two
 * are inconsistent, and a butterfly/condor is the worst case — its whole value is
 * the smile's curvature — so a flat-vol model declares fairly-priced structures
 * huge losers (EV far from $0) and understates the probability of profit.
 *
 * This recovers the density the market is actually implying, via
 * Breeden–Litzenberger:  q(K) = e^{rT} · ∂²C/∂K²  (r≈0 here). We interpolate the
 * smile onto a fine strike grid, price Black–Scholes calls there, take the
 * discrete second difference, floor tiny negatives from quote noise, and
 * normalize. A spread bought at mid then scores EV ≈ 0, as it must under its own
 * pricing measure.
 */
import { normCdf, RISK_FREE_RATE } from "./greeks";
import { payoffAtExpiry, type PayoffLeg } from "./payoff";

/** Discrete terminal-price distribution: prob[i] at price support[i]; Σprob = 1. */
export type Density = { support: number[]; prob: number[] };

export type SmilePoint = { strike: number; iv: number };

/**
 * Black–Scholes call value. Uses the SAME rate the rest of the desk prices with
 * (lib/greeks RISK_FREE_RATE) so the recovered density is consistent with the leg
 * prices — otherwise a directional spread shows a spurious EV from a forward
 * mismatch (forward = spot·e^{rT}, not spot).
 */
function bsCall(S: number, K: number, sigma: number, T: number, rate: number): number {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return Math.max(0, S - K);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (rate + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return S * normCdf(d1) - K * Math.exp(-rate * T) * normCdf(d2);
}

/**
 * One implied vol per strike from a chain, preferring the OTM quote (calls above
 * spot, puts below) since those are the liquid, information-bearing ones.
 */
export function smileFromContracts(
  contracts: { strike: number; right: "call" | "put"; iv: number | null }[],
  spot: number,
): SmilePoint[] {
  const byStrike = new Map<number, { call?: number; put?: number }>();
  for (const c of contracts) {
    if (c.iv == null || !(c.iv > 0)) continue;
    const e = byStrike.get(c.strike) ?? {};
    if (c.right === "call") e.call = c.iv;
    else e.put = c.iv;
    byStrike.set(c.strike, e);
  }
  const out: SmilePoint[] = [];
  for (const [strike, e] of byStrike) {
    const iv = strike >= spot ? (e.call ?? e.put) : (e.put ?? e.call);
    if (iv != null && iv > 0) out.push({ strike, iv });
  }
  return out.sort((a, b) => a.strike - b.strike);
}

/**
 * Monotone cubic (PCHIP / Fritsch–Carlson) interpolation of the smile,
 * flat-extrapolated past the wings. Curvature matters here: the density is the
 * second derivative of the call-price curve, and a butterfly's whole value is
 * that curvature — piecewise-linear IV loses it and undervalues the structure.
 */
function buildSmileInterp(smile: SmilePoint[]): (K: number) => number {
  const xs = smile.map((p) => p.strike);
  const ys = smile.map((p) => p.iv);
  const n = xs.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const d = new Array(n).fill(0);
  d[0] = delta[0];
  d[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      d[i] = 0; // local extremum → flat, no overshoot
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return (K: number) => {
    if (K <= xs[0]) return ys[0];
    if (K >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 1 && K > xs[i + 1]) i++;
    const t = (K - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i] + h10 * h[i] * d[i] + h01 * ys[i + 1] + h11 * h[i] * d[i + 1];
  };
}

/**
 * The market-implied risk-neutral density from a smile. Returns null when the
 * smile is too sparse to trust (caller falls back to a single-lognormal model).
 */
export function riskNeutralDensity(
  smile: SmilePoint[],
  spot: number,
  T: number,
  atmSigma: number,
  opts: { steps?: number; nSigma?: number; rate?: number } = {},
): Density | null {
  if (smile.length < 3 || !(spot > 0) || !(T > 0) || !(atmSigma > 0)) return null;
  const steps = opts.steps ?? 400;
  const nSigma = opts.nSigma ?? 5;
  const rate = opts.rate ?? RISK_FREE_RATE;
  const s = atmSigma * Math.sqrt(T);
  const lo = spot * Math.exp(-nSigma * s);
  const hi = spot * Math.exp(nSigma * s);
  const dK = (hi - lo) / steps;
  if (!(dK > 0)) return null;

  const iv = buildSmileInterp(smile);
  const grid = Array.from({ length: steps + 1 }, (_, i) => lo + i * dK);
  const C = grid.map((k) => bsCall(spot, k, iv(k), T, rate));

  const support: number[] = [];
  const prob: number[] = [];
  for (let i = 1; i < steps; i++) {
    const d2 = (C[i - 1] - 2 * C[i] + C[i + 1]) / (dK * dK);
    support.push(grid[i]);
    prob.push(Math.max(0, d2) * dK); // floor quote-noise negatives
  }
  const total = prob.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  for (let i = 0; i < prob.length; i++) prob[i] /= total;

  // Martingale correction: the risk-neutral density must have mean = the forward
  // (spot·e^{rT}). Finite-difference + truncation leaves a small bias, so rescale
  // the support to enforce it — without this a directional spread (net delta)
  // shows a spurious EV even when fairly priced.
  const forward = spot * Math.exp(rate * T);
  const mean = support.reduce((acc, x, i) => acc + x * prob[i], 0);
  if (mean > 0) {
    const k = forward / mean;
    for (let i = 0; i < support.length; i++) support[i] *= k;
  }
  return { support, prob };
}

/** Expected P&L and win probability of a structure under a density. */
export function scoreUnderDensity(legs: PayoffLeg[], density: Density): { ev: number; pWin: number } {
  let ev = 0;
  let pWin = 0;
  for (let i = 0; i < density.support.length; i++) {
    const p = density.prob[i];
    const pnl = payoffAtExpiry(legs, density.support[i]);
    ev += p * pnl;
    if (pnl > 0) pWin += p;
  }
  return { ev, pWin };
}

/** P&L-at-expiry histogram under a density (fixed bin count). */
export function binsUnderDensity(
  legs: PayoffLeg[],
  density: Density,
  binCount = 41,
): { pnl: number; prob: number }[] {
  const pnls = density.support.map((sPrice) => payoffAtExpiry(legs, sPrice));
  let min = Infinity;
  let max = -Infinity;
  for (const p of pnls) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!(max > min)) return [];
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ pnl: min + width * (i + 0.5), prob: 0 }));
  for (let i = 0; i < pnls.length; i++) {
    let idx = Math.floor((pnls[i] - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].prob += density.prob[i];
  }
  return bins;
}
