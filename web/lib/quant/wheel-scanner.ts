/**
 * Wheel scanner — turn a live option chain into ranked cash-secured-put
 * candidates for running the wheel, each with an explicit trade plan:
 * entry (limit at mid), stop (buy-to-close at N× credit), and total dollars at
 * risk (collateral minus premium). Pure: it takes an already-fetched chain plus
 * a spot, IV rank, and next-earnings date, and returns scored candidates. The
 * data fan-out (CBOE/Yahoo, quotes, earnings) lives in wheel-scanner-data.ts.
 *
 * Conventions mirror lib/wheel.ts so a scanned candidate lines up with how a
 * live position is later reported:
 *   collateral        = strike × 100
 *   annualizedReturn% = credit / strike / dte × 365 × 100
 *   breakeven         = strike − credit
 * Credit/strike are per-share dollars; one contract = 100 shares.
 */

import type { OptionChain, OptionQuote } from "@/lib/yahoo";
import { daysToExpiry, parseOccSymbol } from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
import type { IvRank } from "@/lib/iv-rank";

export type ScanCriteria = {
  /** Days-to-expiry window (inclusive). */
  dteMin: number;
  dteMax: number;
  /** Short-put |delta| band — the assignment-probability sweet spot. */
  deltaMin: number;
  deltaMax: number;
  /** Skip illiquid strikes below this open interest (when OI is known). */
  minOpenInterest: number;
  /** Skip candidates yielding less than this annualized. */
  minAnnualizedPct: number;
  /** Buy-to-close stop as a multiple of the credit received (2 = double). */
  stopMultiple: number;
};

export const DEFAULT_CRITERIA: ScanCriteria = {
  dteMin: 25,
  dteMax: 45,
  deltaMin: 0.15,
  deltaMax: 0.3,
  minOpenInterest: 500,
  minAnnualizedPct: 12,
  stopMultiple: 2,
};

export type PutCandidate = {
  ticker: string;
  occ: string;
  strike: number;
  expiry: string;
  dte: number;
  spot: number;
  /** |delta| of the short put, or null when the source ships no greeks. */
  delta: number | null;
  /** Per-share credit (mid). */
  credit: number;
  /** One-contract credit in dollars (credit × 100). */
  creditTotal: number;
  /** Cash secured behind one contract (strike × 100). */
  collateral: number;
  annualizedPct: number;
  breakeven: number;
  /** How far out-of-the-money, percent of spot. */
  cushionPct: number;
  /** Probability of keeping the full premium ≈ 1 − |delta|. */
  pop: number | null;
  iv: number | null;
  ivRank: number | null;
  openInterest: number | null;
  volume: number | null;
  /** Bid/ask spread as a percent of mid (lower = tighter/cheaper to trade). */
  spreadPct: number | null;
  /** Next earnings date (YYYY-MM-DD) or null. */
  earningsDate: string | null;
  /** True when earnings fall on/before expiry — a binary-risk flag. */
  earningsInWindow: boolean;
  // ── Trade plan ──
  /** Limit price to open (per share) = mid. */
  entry: number;
  /** Buy-to-close price that trips the stop (per share) = credit × stopMultiple. */
  stop: number;
  /** Loss in dollars if stopped out (one contract). */
  stopLossDollars: number;
  /** Max loss in dollars if assigned and the stock goes to zero (one contract). */
  maxAtRisk: number;
  /** 0–100 composite risk/reward rank. */
  score: number;
};

export type TickerScanInput = {
  ticker: string;
  chain: OptionChain;
  spot: number | null;
  ivRank: IvRank | null;
  /** Next earnings date (YYYY-MM-DD) or null. */
  earningsDate: string | null;
};

/** Mid price when a two-sided market exists, else last, else bid. Null if none. */
function creditFor(c: OptionQuote): number | null {
  if (c.bid != null && c.ask != null && c.ask > 0 && c.bid >= 0) return (c.bid + c.ask) / 2;
  if (c.last != null && c.last > 0) return c.last;
  if (c.bid != null && c.bid > 0) return c.bid;
  return null;
}

/** |delta| from source greeks, or modelled from IV when the source omits it. */
function absDelta(c: OptionQuote, spot: number): number | null {
  const d = c.greeks?.delta;
  if (typeof d === "number" && Number.isFinite(d)) return Math.abs(d);
  const parsed = parseOccSymbol(c.occ);
  if (parsed && c.iv != null && c.iv > 0) {
    const g = computeGreeks(parsed, spot, c.iv);
    if (g.delta != null) return Math.abs(g.delta);
  }
  return null;
}

/**
 * Generate scored cash-secured-put candidates for one ticker's chain.
 * Returns [] when there's no usable spot/chain. Never throws.
 */
export function scanPutsForTicker(
  input: TickerScanInput,
  criteria: ScanCriteria = DEFAULT_CRITERIA,
  now: Date = new Date(),
): PutCandidate[] {
  const spot = input.spot ?? input.chain.underlyingPrice;
  if (spot == null || !(spot > 0)) return [];

  const out: PutCandidate[] = [];
  for (const c of input.chain.contracts) {
    if (c.right !== "put") continue;
    if (!(c.strike > 0) || c.strike >= spot) continue; // OTM puts only

    const dte = daysToExpiry(c.expiry, now);
    if (dte < criteria.dteMin || dte > criteria.dteMax) continue;

    const credit = creditFor(c);
    if (credit == null || !(credit > 0)) continue;

    const delta = absDelta(c, spot);
    // Only enforce the delta band when we actually know delta.
    if (delta != null && (delta < criteria.deltaMin || delta > criteria.deltaMax)) continue;

    if (c.openInterest != null && c.openInterest < criteria.minOpenInterest) continue;

    const collateral = c.strike * 100;
    const creditTotal = credit * 100;
    const annualizedPct = (credit / c.strike / dte) * 365 * 100;
    if (annualizedPct < criteria.minAnnualizedPct) continue;

    const breakeven = c.strike - credit;
    const cushionPct = ((spot - c.strike) / spot) * 100;
    const pop = delta != null ? 1 - delta : null;
    const spreadPct =
      c.bid != null && c.ask != null && c.ask > 0 && credit > 0
        ? ((c.ask - c.bid) / credit) * 100
        : null;
    const earningsInWindow =
      input.earningsDate != null && input.earningsDate <= c.expiry && input.earningsDate >= isoDay(now);

    const stop = credit * criteria.stopMultiple;
    const stopLossDollars = (stop - credit) * 100;
    const maxAtRisk = collateral - creditTotal;

    out.push({
      ticker: input.ticker,
      occ: c.occ,
      strike: c.strike,
      expiry: c.expiry,
      dte,
      spot,
      delta,
      credit,
      creditTotal,
      collateral,
      annualizedPct,
      breakeven,
      cushionPct,
      pop,
      iv: c.iv,
      ivRank: input.ivRank?.ivRank ?? null,
      openInterest: c.openInterest,
      volume: c.volume,
      spreadPct,
      earningsDate: input.earningsDate,
      earningsInWindow,
      entry: credit,
      stop,
      stopLossDollars,
      maxAtRisk,
      score: scoreCandidate({
        annualizedPct,
        ivRank: input.ivRank?.ivRank ?? null,
        pop,
        cushionPct,
        openInterest: c.openInterest,
        spreadPct,
        earningsInWindow,
      }),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 0–100 composite. Rewards richer annualized yield, higher IV rank, safer PoP,
 * more downside cushion, and deeper liquidity; penalizes earnings inside the
 * trade window. Weights are deliberate and documented so the ranking is legible.
 */
export function scoreCandidate(f: {
  annualizedPct: number;
  ivRank: number | null;
  pop: number | null;
  cushionPct: number;
  openInterest: number | null;
  spreadPct: number | null;
  earningsInWindow: boolean;
}): number {
  const yieldScore = clamp01(f.annualizedPct / 40); // 40%+ annualized saturates
  const ivScore = f.ivRank != null ? clamp01(f.ivRank / 100) : 0.5;
  const popScore = f.pop != null ? clamp01(f.pop) : 0.6;
  const cushionScore = clamp01(f.cushionPct / 15); // 15%+ OTM saturates
  const oiScore = f.openInterest != null ? clamp01(f.openInterest / 2000) : 0.4;
  const spreadScore = f.spreadPct != null ? clamp01(1 - f.spreadPct / 30) : 0.5; // 30%+ spread ≈ 0
  const liquidityScore = 0.5 * oiScore + 0.5 * spreadScore;
  const earningsScore = f.earningsInWindow ? 0.25 : 1;

  const score =
    0.28 * yieldScore +
    0.16 * ivScore +
    0.2 * popScore +
    0.16 * cushionScore +
    0.1 * liquidityScore +
    0.1 * earningsScore;

  return Math.round(clamp01(score) * 100);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
