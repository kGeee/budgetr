/**
 * General expiry-payoff engine for multi-leg option positions.
 *
 * Everything is derived purely from each leg's parsed OCC contract, its signed
 * SHARE quantity, and its signed total cost basis:
 *
 *   - quantity is in SHARES, not contracts. Brokerages (and our Plaid sync)
 *     report options at 100 shares per contract, so one long contract is +100
 *     and one short contract is −100. This is the unit stored in `holdings`.
 *   - costBasis is the total dollars for the whole leg, signed: a debit paid is
 *     positive, a credit received is negative (e.g. a sold call has costBasis < 0).
 *
 * The position P&L at expiry is piecewise-linear in the underlying price, with
 * kinks only at the strikes, so max profit / max loss / breakevens are all exact
 * from the strike grid plus the two tail slopes — no sampling error. The same
 * engine feeds the corrected risk/reward numbers and the payoff chart.
 *
 * Pure module (no DB / network) so client components can use it directly.
 */

import type { ParsedOption } from "./options";

/** Contracts × 100 — the share multiplier one option contract controls. */
export const CONTRACT_SIZE = 100;

export type PayoffLeg = {
  parsed: ParsedOption;
  /** Signed SHARES (contracts × 100): long > 0, short < 0. */
  quantity: number | null;
  /** Signed total cost basis in dollars: debit paid > 0, credit received < 0. */
  costBasis?: number | null;
};

export type PayoffAnalysis = {
  /** Best-case P&L in dollars, or null when profit is unbounded (long call tail). */
  maxProfit: number | null;
  /** True when the upside is unbounded (report as "Unlimited"). */
  maxProfitUnbounded: boolean;
  /** Worst-case loss as a positive magnitude, or null when the loss is unbounded. */
  maxLoss: number | null;
  /** True when the downside is unbounded (naked short call tail). */
  maxLossUnbounded: boolean;
  /** Every underlying price where P&L crosses zero at expiry, ascending. */
  breakevens: number[];
  /** Net cash to enter, signed: > 0 paid (debit), < 0 received (credit). */
  netDebit: number;
};

/** Intrinsic value per share of one contract at expiry price `S`. */
function intrinsic(p: ParsedOption, S: number): number {
  return p.right === "call" ? Math.max(S - p.strike, 0) : Math.max(p.strike - S, 0);
}

/** Position P&L in dollars at expiry for underlying price `S`. */
export function payoffAtExpiry(legs: PayoffLeg[], S: number): number {
  let pnl = 0;
  for (const l of legs) {
    const shares = l.quantity ?? 0;
    pnl += shares * intrinsic(l.parsed, S) - (l.costBasis ?? 0);
  }
  return pnl;
}

/**
 * dP&L/dS in the far right tail (S → ∞): every call is in the money and every
 * put is worthless, so the slope is the net share count across the call legs.
 * A positive slope means unbounded profit; negative means unbounded loss.
 */
function rightTailSlope(legs: PayoffLeg[]): number {
  let m = 0;
  for (const l of legs) {
    if (l.parsed.right === "call") m += l.quantity ?? 0;
  }
  return m;
}

const EPS = 1e-9;

/**
 * Full risk/reward analysis for a set of legs. Returns all-null economics (but
 * still a valid object) when any leg is missing a cost basis, since there's
 * nothing to net against. Underlying price is floored at 0, so the only place a
 * payoff can run to ±∞ is the right (S → ∞) tail — the left side is always
 * bounded by S = 0.
 */
export function analyzePayoff(legs: PayoffLeg[]): PayoffAnalysis {
  const netDebit = legs.reduce((s, l) => s + (l.costBasis ?? 0), 0);
  const empty: PayoffAnalysis = {
    maxProfit: null,
    maxProfitUnbounded: false,
    maxLoss: null,
    maxLossUnbounded: false,
    breakevens: [],
    netDebit,
  };
  if (legs.length === 0 || legs.some((l) => l.costBasis == null)) return empty;

  const strikes = Array.from(new Set(legs.map((l) => l.parsed.strike))).sort((a, b) => a - b);
  // Kink candidates: S = 0 and each strike. Between consecutive candidates the
  // payoff is linear, so evaluating here captures every extremum and crossing.
  const xs = [0, ...strikes];
  const pts = xs.map((x) => ({ x, y: payoffAtExpiry(legs, x) }));
  const slopeRight = rightTailSlope(legs);

  // ── Max profit / max loss ────────────────────────────────────────────────
  const ys = pts.map((p) => p.y);
  const maxProfitUnbounded = slopeRight > EPS;
  const maxLossUnbounded = slopeRight < -EPS;
  const maxProfit = maxProfitUnbounded ? null : Math.max(...ys);
  const worst = Math.min(...ys);
  const maxLoss = maxLossUnbounded ? null : worst < 0 ? -worst : 0;

  // ── Breakevens ───────────────────────────────────────────────────────────
  const breakevens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0)) {
      breakevens.push(a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y));
    }
  }
  // Right tail beyond the last strike: extend with the tail slope and solve for 0.
  if (Math.abs(slopeRight) > EPS) {
    const last = pts[pts.length - 1];
    const be = last.x - last.y / slopeRight;
    if (be > last.x + EPS) breakevens.push(be);
  }
  // Dedup near-identical crossings (a breakeven landing exactly on a strike).
  const deduped: number[] = [];
  for (const be of breakevens.sort((a, b) => a - b)) {
    if (!deduped.length || Math.abs(be - deduped[deduped.length - 1]) > 1e-6) deduped.push(be);
  }

  return {
    maxProfit,
    maxProfitUnbounded,
    maxLoss,
    maxLossUnbounded,
    breakevens: deduped,
    netDebit,
  };
}

export type PayoffPoint = { price: number; pnl: number };

/**
 * Sample the expiry payoff across a price window for charting. The curve is
 * piecewise-linear with kinks at the strikes, so we return the exact vertices
 * (window ends + every in-window strike) — a polyline through them is exact.
 * `pad` widens the window as a fraction beyond the outermost strike/breakeven so
 * both tails are visible.
 */
export function payoffCurve(
  legs: PayoffLeg[],
  opts: { center?: number | null; pad?: number } = {},
): { points: PayoffPoint[]; min: number; max: number } {
  const strikes = legs.map((l) => l.parsed.strike);
  const anchors = [...strikes];
  if (opts.center != null && Number.isFinite(opts.center)) anchors.push(opts.center);
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  const pad = opts.pad ?? 0.25;
  const span = Math.max(hi - lo, hi * 0.1, 1);
  const min = Math.max(0, lo - span * pad);
  const max = hi + span * pad;

  const vertices = Array.from(
    new Set([min, ...strikes.filter((k) => k > min && k < max), max]),
  ).sort((a, b) => a - b);
  const points = vertices.map((price) => ({ price, pnl: payoffAtExpiry(legs, price) }));
  return { points, min, max };
}
