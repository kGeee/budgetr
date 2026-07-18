/**
 * Opinion-driven option strategy generator + safety analytics.
 *
 * Given a live option chain for ONE expiry, your directional view, a price
 * target, and a risk budget, this proposes candidate strategies built from real
 * chain mid-prices, scores them for how well they fit your inputs, and computes
 * the forward-looking safety numbers an OptionStrat-style tool surfaces:
 * probability of profit, expected value, and a full P&L-at-expiry distribution.
 *
 * Pricing uses the chain's bid/ask midpoint, falling back to the contract's last
 * trade, then to a Black-Scholes theoretical price from the contract IV when a
 * side isn't quoted. Everything is expressed in the same signed SHARE /
 * signed-dollar units the payoff engine expects (contracts × 100), so every
 * candidate feeds `analyzePayoff` / `PayoffDiagram` directly.
 *
 * Pure module (no DB / network); safe in client components + unit-tested.
 */

import { normCdf, RISK_FREE_RATE } from "./greeks";
import { daysToExpiry, type ParsedOption } from "./options";
import { expectedMove, probabilityOfProfit } from "./option-analytics";
import {
  scoreUnderDensity,
  binsUnderDensity,
  riskNeutralDensity,
  smileFromContracts,
  type Density,
} from "./risk-neutral";
import {
  analyzePayoff,
  payoffAtExpiry,
  CONTRACT_SIZE,
  type PayoffAnalysis,
  type PayoffLeg,
} from "./payoff";
import type { OptionQuote } from "./yahoo";

export type Bias = "bullish" | "bearish" | "neutral" | "volatile";

export type RiskInputs = {
  /** Max capital / buying power to deploy, in dollars. */
  budget: number;
  /** Max acceptable loss in dollars (defined-risk cap). */
  maxLoss: number;
  /** Exclude naked / unlimited-loss legs when true. */
  definedOnly: boolean;
};

export type StrategyLeg = {
  right: "call" | "put";
  strike: number;
  /** Signed shares (contracts × 100): long > 0, short < 0. */
  quantity: number;
  /** Per-share premium used to price the leg. */
  mid: number;
};

export type StrategyCandidate = {
  key: string;
  name: string;
  summary: string;
  bias: Bias;
  legs: StrategyLeg[];
  payoffLegs: PayoffLeg[];
  analysis: PayoffAnalysis;
  /** Signed dollars to enter: > 0 net debit paid, < 0 net credit received. */
  netDebit: number;
  /** Capital / buying power at risk to hold the position. */
  capital: number;
  /** Probability of profit at expiry (market-implied, driftless). */
  pop: number | null;
  /** Expected P&L at expiry — market-implied (driftless lognormal, forward = spot). */
  ev: number | null;
  definedRisk: boolean;
  withinBudget: boolean;
  /** 0..1 fit score for the supplied bias + risk inputs. */
  fit: number;
};

export type GenerateInput = {
  underlying: string;
  expiry: string;
  /** Contracts for THIS expiry only. */
  expiryContracts: OptionQuote[];
  spot: number;
  /** ATM implied vol, decimal (0.42). */
  sigma: number;
  /** Your price target for the underlying at expiry. */
  target: number;
  bias: Bias;
  risk: RiskInputs;
  /** Market-implied terminal density (see marketImpliedDensity); optional. */
  density?: Density | null;
};

// ── Pricing ─────────────────────────────────────────────────────────────────

/** Black-Scholes theoretical price per share. */
export function bsPrice(
  right: "call" | "put",
  S: number,
  K: number,
  sigma: number,
  T: number,
  rate: number = RISK_FREE_RATE,
): number {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return Math.max(0, right === "call" ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (rate + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const disc = Math.exp(-rate * T);
  return right === "call"
    ? S * normCdf(d1) - K * disc * normCdf(d2)
    : K * disc * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Per-share premium for a quote: bid/ask midpoint when both are quoted, else the
 * last trade, else a Black-Scholes price from the contract IV. Null when nothing
 * usable is available.
 */
export function midQuote(
  q: OptionQuote,
  spot: number | null,
  T: number,
): number | null {
  if (q.bid != null && q.ask != null && q.bid >= 0 && q.ask > 0) {
    const m = (q.bid + q.ask) / 2;
    if (m > 0) return m;
  }
  if (q.last != null && q.last > 0) return q.last;
  if (q.iv != null && q.iv > 0 && spot != null && spot > 0 && T > 0) {
    return bsPrice(q.right, spot, q.strike, q.iv, T);
  }
  return null;
}

/**
 * The market-implied terminal-price density for an expiry, recovered from its vol
 * smile (Breeden–Litzenberger). Pass it into probabilityOfProfit / pnlDistribution
 * to score any structure against the same distribution the chain is priced under.
 * Returns null when the chain is too sparse — callers then fall back to the
 * single-lognormal model.
 */
export function marketImpliedDensity(
  expiryContracts: OptionQuote[],
  spot: number,
  sigma: number,
  T: number,
): Density | null {
  return riskNeutralDensity(smileFromContracts(expiryContracts, spot), spot, T, sigma);
}

// ── Distribution / expected value ────────────────────────────────────────────

/**
 * P&L-at-expiry distribution under a lognormal terminal price whose MEAN is
 * `center` (so `center = spot` is the driftless case, `center = target`
 * expresses your view). Returns the expected P&L, the win probability, and a
 * histogram over P&L buckets for charting. Null when unmodelable.
 */
export function pnlDistribution(
  legs: PayoffLeg[],
  center: number,
  sigma: number,
  T: number,
  opts: { steps?: number; bins?: number; density?: Density | null } = {},
): { ev: number; pWin: number; bins: { pnl: number; prob: number }[] } | null {
  const binCount = opts.bins ?? 41;
  // Market-implied (smile) density when available — consistent with the leg
  // prices, so a fairly-priced spread nets EV ≈ 0 (± carry) instead of the large
  // spurious loss a single flat-vol lognormal reports for butterflies/condors.
  if (opts.density) {
    const { ev, pWin } = scoreUnderDensity(legs, opts.density);
    return { ev, pWin, bins: binsUnderDensity(legs, opts.density, binCount) };
  }
  if (!(center > 0) || !(sigma > 0) || !(T > 0)) return null;
  const steps = opts.steps ?? 240;
  const s = sigma * Math.sqrt(T);
  // Mean of a lognormal is exp(m + s²/2); set it to `center`.
  const m = Math.log(center) - 0.5 * s * s;
  const lnCdf = (x: number) => (x <= 0 ? 0 : normCdf((Math.log(x) - m) / s));

  // Price grid spanning ±4σ around the center, integrated by CDF increments.
  const lo = center * Math.exp(-4 * s);
  const hi = center * Math.exp(4 * s);
  const samples: { pnl: number; prob: number }[] = [];
  let ev = 0;
  let pWin = 0;
  let prevX = lo;
  let prevCdf = lnCdf(lo);
  for (let i = 1; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    const cdf = lnCdf(x);
    const prob = cdf - prevCdf;
    const midX = (prevX + x) / 2;
    const pnl = payoffAtExpiry(legs, midX);
    ev += prob * pnl;
    if (pnl > 0) pWin += prob;
    samples.push({ pnl, prob });
    prevX = x;
    prevCdf = cdf;
  }

  // Bucket P&L into a fixed number of bins for the histogram.
  let minPnl = Infinity;
  let maxPnl = -Infinity;
  for (const sample of samples) {
    if (sample.pnl < minPnl) minPnl = sample.pnl;
    if (sample.pnl > maxPnl) maxPnl = sample.pnl;
  }
  if (!(maxPnl > minPnl)) return { ev, pWin, bins: [] };
  const width = (maxPnl - minPnl) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    pnl: minPnl + width * (i + 0.5),
    prob: 0,
  }));
  for (const sample of samples) {
    let idx = Math.floor((sample.pnl - minPnl) / width);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].prob += sample.prob;
  }
  return { ev, pWin, bins };
}

// ── Chain indexing ───────────────────────────────────────────────────────────

type StrikeQuote = { call: OptionQuote | null; put: OptionQuote | null };

function indexChain(expiryContracts: OptionQuote[]): { strikes: number[]; at: Map<number, StrikeQuote> } {
  const at = new Map<number, StrikeQuote>();
  for (const c of expiryContracts) {
    const e = at.get(c.strike) ?? { call: null, put: null };
    if (c.right === "call") e.call = c;
    else e.put = c;
    at.set(c.strike, e);
  }
  return { strikes: Array.from(at.keys()).sort((a, b) => a - b), at };
}

function nearestStrike(strikes: number[], target: number): number | null {
  if (!strikes.length) return null;
  return strikes.reduce((best, k) => (Math.abs(k - target) < Math.abs(best - target) ? k : best), strikes[0]);
}

function parsedFor(underlying: string, expiry: string, strike: number, right: "call" | "put"): ParsedOption {
  return { occ: `${underlying}${expiry}${right}${strike}`, underlying, expiry, right, strike };
}

// ── Candidate builder ────────────────────────────────────────────────────────

type LegSpec = { right: "call" | "put"; strike: number | null; contracts: number };

type Ctx = {
  underlying: string;
  expiry: string;
  at: Map<number, StrikeQuote>;
  spot: number;
  sigma: number;
  T: number;
  density?: Density | null;
};

/**
 * Turn a set of leg specs into a priced candidate. Returns null if any strike is
 * missing from the chain or can't be priced, or if two legs collapse to nothing.
 */
function build(
  ctx: Ctx,
  spec: {
    key: string;
    name: string;
    bias: Bias;
    legs: LegSpec[];
    definedRisk: boolean;
    capital?: (analysis: PayoffAnalysis, legs: StrategyLeg[]) => number;
    risk: RiskInputs;
  },
): StrategyCandidate | null {
  const legs: StrategyLeg[] = [];
  const payoffLegs: PayoffLeg[] = [];
  for (const l of spec.legs) {
    if (l.strike == null || l.contracts === 0) return null;
    const sq = ctx.at.get(l.strike);
    const q = l.right === "call" ? sq?.call : sq?.put;
    if (!q) return null;
    const mid = midQuote(q, ctx.spot, ctx.T);
    if (mid == null) return null;
    const quantity = l.contracts * CONTRACT_SIZE;
    legs.push({ right: l.right, strike: l.strike, quantity, mid });
    payoffLegs.push({
      parsed: parsedFor(ctx.underlying, ctx.expiry, l.strike, l.right),
      quantity,
      costBasis: mid * quantity,
    });
  }
  if (!legs.length) return null;

  const analysis = analyzePayoff(payoffLegs);
  const netDebit = analysis.netDebit;
  const capital = spec.capital
    ? spec.capital(analysis, legs)
    : analysis.maxLoss ?? Math.abs(netDebit);
  const T = ctx.T;
  const pop = probabilityOfProfit(payoffLegs, analysis, ctx.spot, ctx.sigma, T, ctx.density);
  // Market-implied EV/POP under the recovered smile density (falls back to a
  // single lognormal only when the chain is too sparse to build a density).
  const dist = pnlDistribution(payoffLegs, ctx.spot, ctx.sigma, T, { density: ctx.density });
  const ev = dist?.ev ?? null;
  const withinBudget =
    capital <= spec.risk.budget && (analysis.maxLoss ?? Infinity) <= spec.risk.maxLoss;

  const summary = legs
    .map((l) => `${l.quantity > 0 ? "+" : "−"}${Math.abs(l.quantity) / CONTRACT_SIZE} ${strikeLabel(l.strike)}${l.right[0]}`)
    .join(" / ");

  return {
    key: spec.key,
    name: spec.name,
    summary,
    bias: spec.bias,
    legs,
    payoffLegs,
    analysis,
    netDebit,
    capital,
    pop,
    ev,
    definedRisk: spec.definedRisk,
    withinBudget,
    fit: 0, // scored after
  };
}

function strikeLabel(k: number): string {
  return Number.isInteger(k) ? `$${k}` : `$${k.toFixed(2)}`;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Reward:risk as a plain multiple; unbounded upside scores as a generous 3×. */
function rewardRisk(a: PayoffAnalysis): number {
  if (a.maxProfitUnbounded) return 3;
  if (a.maxProfit != null && a.maxLoss != null && a.maxLoss > 0) return a.maxProfit / a.maxLoss;
  return 0;
}

/**
 * Composite 0..1 fit score. Rewards: profiting at your expected outcome price,
 * a healthy probability of profit, positive expected value per dollar risked, a
 * decent reward:risk, and staying inside your budget.
 */
function scoreFit(c: StrategyCandidate, input: GenerateInput, em: number): number {
  const directional = input.bias === "bullish" || input.bias === "bearish";
  const outcome = directional ? input.target : input.spot;
  const pnlAtOutcome = payoffAtExpiry(c.payoffLegs, outcome);
  const profitRef = c.analysis.maxProfitUnbounded
    ? Math.max(Math.abs(pnlAtOutcome), em * CONTRACT_SIZE)
    : c.analysis.maxProfit ?? Math.abs(c.netDebit);
  const dirScore = clamp01(pnlAtOutcome / (Math.abs(profitRef) || 1));

  const popScore = c.pop ?? 0;
  const evScore = c.ev != null && c.capital > 0 ? clamp01(c.ev / c.capital + 0.5) : 0.5;
  const rrScore = clamp01(rewardRisk(c.analysis) / 3);
  const budgetScore = c.withinBudget ? 1 : 0;

  return clamp01(
    0.34 * dirScore + 0.2 * popScore + 0.18 * evScore + 0.16 * rrScore + 0.12 * budgetScore,
  );
}

// ── Generation ───────────────────────────────────────────────────────────────

/**
 * Propose candidate strategies for the given view + risk inputs, priced off the
 * live chain and ranked best-fit first. Undefined-risk structures are omitted
 * when `risk.definedOnly` is set. Returns [] when the expiry can't be modeled.
 */
export function generateStrategies(input: GenerateInput): StrategyCandidate[] {
  const { underlying, expiry, expiryContracts, spot, sigma, target, bias, risk } = input;
  const dte = daysToExpiry(expiry);
  if (!(spot > 0) || !(sigma > 0) || dte < 0) return [];
  // Floor same-day (0-DTE) expiries to half a day so probability / EV / greeks
  // stay finite — the payoff itself is unaffected.
  const T = Math.max(dte, 0.5) / 365;

  const { strikes, at } = indexChain(expiryContracts);
  if (strikes.length < 2) return [];
  const em = expectedMove(spot, sigma, T) ?? spot * 0.05;
  const density = input.density ?? marketImpliedDensity(expiryContracts, spot, sigma, T);
  const ctx: Ctx = { underlying, expiry, at, spot, sigma, T, density };

  const near = (t: number) => nearestStrike(strikes, t);
  const cashSecuredCapital = (legs: StrategyLeg[]) =>
    legs.reduce((s, l) => (l.right === "put" && l.quantity < 0 ? s + l.strike * Math.abs(l.quantity) : s), 0);

  const out: (StrategyCandidate | null)[] = [];

  if (bias === "bullish") {
    out.push(
      build(ctx, {
        key: "long-call",
        name: "Long call",
        bias,
        legs: [{ right: "call", strike: near(spot), contracts: 1 }],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "bull-call-spread",
        name: "Bull call spread",
        bias,
        legs: [
          { right: "call", strike: near(spot), contracts: 1 },
          { right: "call", strike: near(Math.max(target, spot + em)), contracts: -1 },
        ],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "bull-put-spread",
        name: "Bull put spread (credit)",
        bias,
        legs: [
          { right: "put", strike: near(spot - em), contracts: -1 },
          { right: "put", strike: near(spot - 2 * em), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "cash-secured-put",
        name: "Cash-secured put",
        bias,
        legs: [{ right: "put", strike: near(spot - em), contracts: -1 }],
        definedRisk: true,
        capital: (_a, legs) => cashSecuredCapital(legs),
        risk,
      }),
    );
  } else if (bias === "bearish") {
    out.push(
      build(ctx, {
        key: "long-put",
        name: "Long put",
        bias,
        legs: [{ right: "put", strike: near(spot), contracts: 1 }],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "bear-put-spread",
        name: "Bear put spread",
        bias,
        legs: [
          { right: "put", strike: near(spot), contracts: 1 },
          { right: "put", strike: near(Math.min(target, spot - em)), contracts: -1 },
        ],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "bear-call-spread",
        name: "Bear call spread (credit)",
        bias,
        legs: [
          { right: "call", strike: near(spot + em), contracts: -1 },
          { right: "call", strike: near(spot + 2 * em), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
    );
  } else if (bias === "neutral") {
    out.push(
      build(ctx, {
        key: "iron-condor",
        name: "Iron condor",
        bias,
        legs: [
          { right: "put", strike: near(spot - 2 * em), contracts: 1 },
          { right: "put", strike: near(spot - em), contracts: -1 },
          { right: "call", strike: near(spot + em), contracts: -1 },
          { right: "call", strike: near(spot + 2 * em), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "iron-butterfly",
        name: "Iron butterfly",
        bias,
        legs: [
          { right: "put", strike: near(spot - 2 * em), contracts: 1 },
          { right: "put", strike: near(spot), contracts: -1 },
          { right: "call", strike: near(spot), contracts: -1 },
          { right: "call", strike: near(spot + 2 * em), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
    );
    if (!risk.definedOnly) {
      out.push(
        build(ctx, {
          key: "short-strangle",
          name: "Short strangle (undefined risk)",
          bias,
          legs: [
            { right: "put", strike: near(spot - em), contracts: -1 },
            { right: "call", strike: near(spot + em), contracts: -1 },
          ],
          definedRisk: false,
          capital: (_a, legs) => cashSecuredCapital(legs) + spot * CONTRACT_SIZE * 0.2,
          risk,
        }),
      );
    }
  } else {
    // volatile
    out.push(
      build(ctx, {
        key: "long-straddle",
        name: "Long straddle",
        bias,
        legs: [
          { right: "call", strike: near(spot), contracts: 1 },
          { right: "put", strike: near(spot), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
      build(ctx, {
        key: "long-strangle",
        name: "Long strangle",
        bias,
        legs: [
          { right: "call", strike: near(spot + em), contracts: 1 },
          { right: "put", strike: near(spot - em), contracts: 1 },
        ],
        definedRisk: true,
        risk,
      }),
    );
  }

  const candidates = out.filter((c): c is StrategyCandidate => c != null);
  // De-dup structures that collapsed to identical strikes (e.g. em < 1 strike).
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const sig = c.legs.map((l) => `${l.right}${l.strike}${l.quantity}`).join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  for (const c of unique) c.fit = scoreFit(c, input, em);
  return unique.sort((a, b) => b.fit - a.fit);
}
