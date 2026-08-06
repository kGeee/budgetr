/**
 * LEAPS analysis: a long-dated call as a substitute for owning the shares.
 *
 * The question this answers is not "is this option cheap" but "should I own
 * 100 shares or one long call, and what exactly am I paying for the
 * difference". Everything here is pure and per-share unless a field says
 * otherwise; the view multiplies by 100.
 *
 * ── The comparison, done properly ──────────────────────────────────────────
 *
 * Compare two portfolios held to the option's expiry:
 *
 *   SHARES  outlay S, terminal wealth  S_T + (dividends collected)
 *   CALL    outlay P, terminal wealth  max(S_T − K, 0) + (S − P) grown at r
 *
 * The call buyer keeps S − P in cash, so a comparison that ignores what that
 * cash earns overstates the option's cost — at a 4.5% short rate over two years
 * that is most of the premium on a deep ITM strike. Above the strike both
 * payoffs have slope 1, so their difference is a CONSTANT:
 *
 *   call − shares  =  (S − P)·r·T  −  extrinsic  −  q·S·T
 *                     └ interest ┘   └─ what the option costs you ─┘
 *
 * Two consequences worth stating plainly, because they're the whole trade:
 *
 *   1. Above the strike the call trails (or beats) the shares by a FIXED
 *      amount no matter how far the stock runs. There is no upside crossover.
 *      Leverage shows up in return-on-capital, not in dollars.
 *   2. Below the strike the call is worth nothing while the shares keep
 *      falling, so there is a price beneath which the call wins. That price is
 *      the premium you're paying for, and `leapWinsBelow` names it.
 *
 * ── What we deliberately don't model ──────────────────────────────────────
 *
 * American early exercise (a deep ITM call ahead of a fat dividend can be worth
 * exercising early), borrow costs, assignment mechanics, and tax treatment —
 * LEAPS held over a year are long-term gains in the US, which is frequently the
 * actual reason to prefer them, and is not something this file should pretend
 * to advise on. Dividends are modelled as a continuous yield, which is close
 * enough over a multi-year horizon and wrong for a lumpy special dividend.
 */

import { normCdf, RISK_FREE_RATE } from "./greeks";

/** Contracts at or beyond this many days are treated as LEAPS. */
export const LEAPS_MIN_DTE = 365;

const DAYS_PER_YEAR = 365;

export type LeapsInputs = {
  /** Underlying spot, per share. */
  spot: number;
  strike: number;
  /** Option premium per share (mid preferred; the view falls back to last). */
  premium: number;
  /** Calendar days to expiry. */
  dte: number;
  /** Implied vol as a decimal (0.28). Null disables probability + theta. */
  iv?: number | null;
  /** Per-share delta if the feed supplied one; computed from IV when absent. */
  delta?: number | null;
  /** Annual dividend yield as a decimal (0.005). Null is treated as zero. */
  dividendYield?: number | null;
  /** Short rate used both for discounting and for the cash the call frees up. */
  rate?: number;
  /** What a broker would charge to buy the shares on margin instead. */
  marginRate?: number;
};

export type LeapsAnalysis = {
  years: number;

  // ── capital ──
  /** Cost of one contract (premium × 100). */
  contractCost: number;
  /** Cost of the 100 shares it stands in for. */
  sharesCost: number;
  capitalFreed: number;
  capitalFreedPct: number;

  // ── structure ──
  intrinsic: number;
  extrinsic: number;
  /** Extrinsic as a share of spot — the cleanest "what am I paying" number. */
  extrinsicPctOfSpot: number;
  /** K/S − 1. Negative is in the money for a call. */
  moneyness: number;

  // ── exposure ──
  delta: number | null;
  /** Shares this contract currently behaves like (delta × 100). */
  deltaEquivalentShares: number | null;
  /** Exposure controlled per dollar outlaid. */
  effectiveLeverage: number | null;

  // ── carry: what the leverage actually costs ──
  forgoneDividends: number;
  /** Extrinsic + dividends you won't receive, over the life, per share. */
  financingCost: number;
  /** Capital the call frees up, per share (S − P). */
  financedAmount: number;
  /**
   * True when the strike is at or below spot, i.e. the call actually stands in
   * for the shares. Out of the money it is a directional bet, not a
   * replacement, and the financing framing below stops meaning anything.
   */
  isStockReplacement: boolean;
  /**
   * financingCost as an annual rate on the freed capital — the number a trader
   * means by "what rate am I paying to borrow the stock". Null when the strike
   * is out of the money: quoting it there flatters a lottery ticket, because
   * the denominator pretends you hold 100 shares of exposure when a 0.35-delta
   * call plainly doesn't. Use `costPerExposureRate` to compare across strikes.
   */
  impliedFinancingRate: number | null;
  /**
   * financingCost per dollar of DELTA-WEIGHTED exposure, annualised. Defined at
   * every strike, so it ranks honestly: a cheap OTM call buys little exposure
   * per dollar and lands high, a deep ITM one buys nearly all of it and lands
   * low. This is the column to sort a chain by.
   */
  costPerExposureRate: number | null;
  /** Interest that freed capital earns at `rate`, over the life, per share. */
  interestOnFreedCapital: number;
  /** financingCost − interest earned. Negative means the call is cheaper. */
  netCarry: number;
  /** impliedFinancingRate − rate. The honest cost of the leverage. */
  netCarryRate: number | null;
  /** impliedFinancingRate − marginRate. Negative means cheaper than margin. */
  vsMarginRate: number | null;

  // ── outcomes ──
  breakeven: number;
  breakevenMovePct: number;
  /** Max loss on the contract (the whole premium). */
  maxLoss: number;
  /** At or below this price at expiry the call expires worthless. */
  worthlessAtOrBelow: number;
  /** What the shares would have lost at that same price, as a fraction. */
  sharesLossAtThatPrice: number;
  /**
   * Fixed per-share amount by which the call trails the shares at ANY price
   * above the strike. Negative means the call is ahead everywhere above it.
   */
  trailsSharesAboveStrikeBy: number;
  /**
   * Price at expiry below which the call beats the shares — null when the call
   * is ahead at every price, which is what `beatsSharesEverywhere` reports. The
   * crossover is derived assuming the call has expired worthless, so it only
   * means anything below the strike; when the solution lands above it, the
   * assumption is violated and the number would be nonsense to print.
   */
  leapWinsBelow: number | null;
  /**
   * True when the interest on the freed capital more than covers the option's
   * time value and forgone dividends. The call then wins at every terminal
   * price — better above the strike by a fixed amount, and better below it
   * because its loss stops. Rare, and worth saying plainly when it happens.
   */
  beatsSharesEverywhere: boolean;

  // ── decay + odds ──
  /** Black-Scholes theta per calendar day, per share. */
  thetaPerDay: number | null;
  /** Decay over the next 30 days as a share of the premium paid. */
  thetaPctOfPremiumPerMonth: number | null;
  /** Risk-neutral probability of finishing above breakeven. */
  probAboveBreakeven: number | null;
};

function d1d2(S: number, K: number, T: number, sigma: number, r: number) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  return { d1, d2: d1 - sigma * sqrtT };
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Analyse one long call as a stock substitute. Returns null only when the
 * inputs can't describe a trade at all (non-positive spot/strike/premium, or a
 * contract that has already expired) — everything softer degrades to a null
 * field so the table can show an em dash rather than vanish.
 */
export function analyzeLeap(input: LeapsInputs): LeapsAnalysis | null {
  const { spot: S, strike: K, premium: P, dte } = input;
  if (!(S > 0) || !(K > 0) || !(P > 0) || !(dte > 0)) return null;

  const r = input.rate ?? RISK_FREE_RATE;
  const q = input.dividendYield ?? 0;
  const sigma = input.iv != null && input.iv > 0 ? input.iv : null;
  const T = dte / DAYS_PER_YEAR;

  const intrinsic = Math.max(S - K, 0);
  const extrinsic = Math.max(P - intrinsic, 0);

  // Carry. `financedAmount` is the capital you did NOT have to put up, which is
  // the thing the financing rate should be quoted against — not the strike.
  // For a deep ITM call the two nearly coincide; for an OTM one they don't, and
  // quoting against the strike would flatter a lottery ticket.
  const financedAmount = Math.max(S - P, 0);
  const forgoneDividends = q * S * T;
  const financingCost = extrinsic + forgoneDividends;
  const interestOnFreedCapital = financedAmount * r * T;
  const netCarry = financingCost - interestOnFreedCapital;

  // Delta: prefer the feed's, fall back to Black-Scholes, else null.
  let delta = input.delta ?? null;
  if (delta == null && sigma != null) delta = normCdf(d1d2(S, K, T, sigma, r).d1);

  // Only an in-the-money call replicates share ownership closely enough for the
  // "what rate am I paying to borrow the stock" question to have an answer.
  const isStockReplacement = K <= S;
  const impliedFinancingRate =
    isStockReplacement && financedAmount > 0 && T > 0
      ? financingCost / financedAmount / T
      : null;

  // The cross-strike-comparable version: cost per dollar of exposure actually
  // obtained. Without the delta weighting a $6 OTM call looks like cheaper
  // financing than a $6-extrinsic ITM one, which is backwards — it buys a third
  // of the exposure for the same money.
  const exposure = delta == null ? null : delta * S;
  const costPerExposureRate =
    exposure != null && exposure > 0 && T > 0 ? financingCost / exposure / T : null;

  const netCarryRate = impliedFinancingRate == null ? null : impliedFinancingRate - r;
  const vsMarginRate =
    impliedFinancingRate == null || input.marginRate == null
      ? null
      : impliedFinancingRate - input.marginRate;

  // Theta per calendar day, and what that costs over the next month. LEAPS
  // decay slowly at first, which is most of their appeal — showing the monthly
  // figure as a share of premium is what makes that legible.
  let thetaPerDay: number | null = null;
  if (sigma != null) {
    const { d1, d2 } = d1d2(S, K, T, sigma, r);
    const annual =
      -(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2);
    thetaPerDay = annual / DAYS_PER_YEAR;
  }
  const thetaPctOfPremiumPerMonth =
    thetaPerDay == null ? null : Math.abs(thetaPerDay * 30) / P;

  const breakeven = K + P;
  const probAboveBreakeven =
    sigma != null ? normCdf(d1d2(S, breakeven, T, sigma, r).d2) : null;

  // Above the strike both legs have slope 1, so the gap is constant. Positive
  // means the call trails the shares by that much per share, forever.
  const trailsSharesAboveStrikeBy = netCarry;

  // Below the strike the call is worthless and holds only the freed cash; the
  // shares keep falling. Solve for where the two terminal wealths meet.
  //
  // That solve assumes the call finished out of the money, so it's only valid
  // below the strike. The two expressions agree exactly AT the strike, so a
  // solution landing above it is the same statement as netCarry ≤ 0: the call
  // is ahead everywhere and there is no crossover to quote. Reporting the raw
  // root anyway prints a price above the strike and reads as a contradiction
  // next to "beats the shares above the strike".
  const rawCrossover = financedAmount * (1 + r * T) - q * S * T;
  const beatsSharesEverywhere = netCarry <= 0;
  const leapWinsBelow = beatsSharesEverywhere ? null : rawCrossover;

  return {
    years: T,

    contractCost: P * 100,
    sharesCost: S * 100,
    capitalFreed: (S - P) * 100,
    capitalFreedPct: (S - P) / S,

    intrinsic,
    extrinsic,
    extrinsicPctOfSpot: extrinsic / S,
    moneyness: K / S - 1,

    delta,
    deltaEquivalentShares: delta == null ? null : delta * 100,
    effectiveLeverage: delta == null ? null : (delta * S) / P,

    forgoneDividends,
    financingCost,
    financedAmount,
    isStockReplacement,
    impliedFinancingRate,
    costPerExposureRate,
    interestOnFreedCapital,
    netCarry,
    netCarryRate,
    vsMarginRate,

    breakeven,
    breakevenMovePct: breakeven / S - 1,
    maxLoss: P * 100,
    worthlessAtOrBelow: K,
    sharesLossAtThatPrice: Math.max(0, (S - K) / S),
    trailsSharesAboveStrikeBy,
    leapWinsBelow,
    beatsSharesEverywhere,

    thetaPerDay,
    thetaPctOfPremiumPerMonth,
    probAboveBreakeven,
  };
}

export type LeapsComparisonPoint = {
  price: number;
  /** P/L on 100 shares, including dividends collected over the life. */
  shares: number;
  /** P/L on one contract, including interest earned on the capital it freed. */
  leap: number;
};

/**
 * Terminal P/L for both positions across a price range — the chart behind the
 * table. Both series include the parts a naive payoff diagram drops: dividends
 * on the shares, and interest on the cash the call didn't tie up. Leaving those
 * out is what makes LEAPS look worse than they are on most payoff charts.
 */
export function compareToShares(
  input: LeapsInputs,
  analysis: LeapsAnalysis,
  prices: number[],
): LeapsComparisonPoint[] {
  const { spot: S, strike: K, premium: P } = input;
  const q = input.dividendYield ?? 0;
  const T = analysis.years;
  const dividends = q * S * T;
  const interest = analysis.interestOnFreedCapital;

  return prices.map((price) => ({
    price,
    shares: (price - S + dividends) * 100,
    leap: (Math.max(price - K, 0) - P + interest) * 100,
  }));
}

/** An evenly spaced price ladder around spot, for the comparison chart. */
export function priceLadder(spot: number, spanPct = 0.6, steps = 81): number[] {
  const lo = Math.max(0.01, spot * (1 - spanPct));
  const hi = spot * (1 + spanPct);
  const step = (hi - lo) / (steps - 1);
  return Array.from({ length: steps }, (_, i) => lo + i * step);
}

/**
 * Delta at or above which a call is behaving enough like the shares to be
 * worth comparing against them. Below it you're looking at a directional bet,
 * which is a different question and belongs on the Chain tab.
 */
export const REPLACEMENT_MIN_DELTA = 0.55;

export type LeapsCandidate = LeapsAnalysis & {
  occ: string;
  expiry: string;
  strike: number;
  dte: number;
  premium: number;
  iv: number | null;
  openInterest: number | null;
};

type ChainRow = {
  occ: string;
  expiry: string;
  strike: number;
  right: "call" | "put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  iv: number | null;
  openInterest: number | null;
  greeks?: { delta?: number | null } | null;
};

/** Mid when both sides quote, else last. LEAPS spreads are wide; mid matters. */
export function midOrLast(row: ChainRow): number | null {
  if (row.bid != null && row.ask != null && row.bid > 0 && row.ask > 0) {
    return (row.bid + row.ask) / 2;
  }
  return row.last != null && row.last > 0 ? row.last : null;
}

/**
 * Every long-dated call on the chain, analysed and sorted by strike.
 *
 * Filters to calls beyond `minDte` with a usable price. If nothing qualifies —
 * plenty of symbols list nothing past a year — the caller gets an empty array
 * and should say so rather than silently showing near-dated contracts, which
 * would answer a different question than the one asked.
 */
export function analyzeChainForLeaps(
  rows: ChainRow[],
  opts: {
    spot: number;
    dteFor: (expiry: string) => number;
    dividendYield?: number | null;
    rate?: number;
    marginRate?: number;
    minDte?: number;
  },
): LeapsCandidate[] {
  const minDte = opts.minDte ?? LEAPS_MIN_DTE;
  const out: LeapsCandidate[] = [];

  for (const row of rows) {
    if (row.right !== "call") continue;
    const dte = opts.dteFor(row.expiry);
    if (!(dte >= minDte)) continue;
    const premium = midOrLast(row);
    if (premium == null) continue;

    const analysis = analyzeLeap({
      spot: opts.spot,
      strike: row.strike,
      premium,
      dte,
      iv: row.iv,
      delta: row.greeks?.delta ?? null,
      dividendYield: opts.dividendYield,
      rate: opts.rate,
      marginRate: opts.marginRate,
    });
    if (!analysis) continue;

    out.push({
      ...analysis,
      occ: row.occ,
      expiry: row.expiry,
      strike: row.strike,
      dte,
      premium,
      iv: row.iv,
      openInterest: row.openInterest,
    });
  }

  return out.sort((a, b) => a.dte - b.dte || a.strike - b.strike);
}

/** Is this call close enough to share-like to belong in a replacement table? */
export function isReplacementCandidate(
  c: Pick<LeapsCandidate, "delta" | "isStockReplacement">,
  minDelta = REPLACEMENT_MIN_DELTA,
): boolean {
  // Delta is the real test. When the feed doesn't supply one and there's no IV
  // to derive it from, fall back to moneyness so the row isn't silently lost.
  return c.delta == null ? c.isStockReplacement : c.delta >= minDelta;
}

export type LeapsExpiryGroup = {
  expiry: string;
  dte: number;
  candidates: LeapsCandidate[];
};

/**
 * Bucket candidates by expiry, nearest first.
 *
 * A liquid name lists hundreds of long-dated calls — AAPL alone returns ~400 —
 * so anything that renders "every LEAP" at once produces a wall rather than a
 * view. Picking an expiry is the natural first cut: it's the decision a trader
 * makes first, and it brings the strike list down to a normal chain table.
 */
export function groupByExpiry(candidates: LeapsCandidate[]): LeapsExpiryGroup[] {
  const byExpiry = new Map<string, LeapsCandidate[]>();
  for (const c of candidates) {
    const list = byExpiry.get(c.expiry);
    if (list) list.push(c);
    else byExpiry.set(c.expiry, [c]);
  }
  return [...byExpiry.entries()]
    .map(([expiry, list]) => ({
      expiry,
      dte: list[0].dte,
      candidates: [...list].sort((a, b) => a.strike - b.strike),
    }))
    .sort((a, b) => a.dte - b.dte);
}

/**
 * The contract to open on: the deepest in-the-money call that still clears the
 * replacement delta, which is the canonical stock substitute. Falls back to
 * whatever is closest to spot when nothing qualifies.
 */
export function defaultCandidate(candidates: LeapsCandidate[]): LeapsCandidate | null {
  if (!candidates.length) return null;
  const replacements = candidates.filter((c) => isReplacementCandidate(c));
  if (replacements.length) {
    return replacements.reduce((a, b) => (a.strike < b.strike ? a : b));
  }
  return candidates.reduce((a, b) =>
    Math.abs(a.moneyness) < Math.abs(b.moneyness) ? a : b,
  );
}
