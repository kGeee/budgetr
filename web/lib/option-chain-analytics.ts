/**
 * Full option-chain analytics — the numbers an options desk reads off a single
 * underlying's chain: the volatility smile/skew, the IV term structure, open
 * interest & volume positioning, max pain, put/call ratios, dealer gamma
 * exposure (GEX), and the (strike × expiry × IV) grid that feeds the 3D surface.
 *
 * Unlike `option-analytics.ts` (which reasons about a *position's* payoff), this
 * module reasons about the *market's* chain: every listed strike and expiry, not
 * just the legs you hold. It's the data layer for the per-ticker options route.
 *
 * Pure module (no DB / network) so the per-ticker view can call it client-side.
 * Everything takes the shared `OptionQuote[]` shape from the CBOE/Yahoo fetchers.
 */

import { daysToExpiry } from "./options";
import type { OptionQuote } from "./yahoo";

/** 100 shares per listed US equity option contract. */
export const CONTRACT_MULTIPLIER = 100;

// ── Expiry grouping & classification ────────────────────────────────────────

export type ExpiryKind = "weekly" | "monthly" | "quarterly";

/** All distinct expiries in the chain, ascending, with DTE + a rough kind. */
export type ExpiryInfo = {
  expiry: string; // YYYY-MM-DD
  dte: number;
  kind: ExpiryKind;
  contracts: number;
};

/**
 * Standard monthly options expire on the third Friday of the month; everything
 * else the exchanges list (Mondays/Wednesdays/Fridays) is a "weekly". Quarter-end
 * months (Mar/Jun/Sep/Dec) third Fridays are flagged quarterly. This is a
 * calendar heuristic — it doesn't need the contract to actually be a standard.
 */
export function classifyExpiry(expiry: string): ExpiryKind {
  const [y, m, d] = expiry.split("-").map(Number);
  if (!y || !m || !d) return "weekly";
  // Day-of-week for the expiry date at UTC noon (avoids TZ edge flips).
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = date.getUTCDay(); // 0 Sun … 5 Fri
  // Third Friday: the Friday whose date falls in 15..21.
  const isThirdFriday = dow === 5 && d >= 15 && d <= 21;
  if (!isThirdFriday) return "weekly";
  return m === 3 || m === 6 || m === 9 || m === 12 ? "quarterly" : "monthly";
}

/** Distinct expiries present in `contracts`, ascending by date. */
export function listExpiries(contracts: OptionQuote[], now: Date = new Date()): ExpiryInfo[] {
  const counts = new Map<string, number>();
  for (const c of contracts) {
    if (!c.expiry) continue;
    counts.set(c.expiry, (counts.get(c.expiry) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([expiry, contractsCount]) => ({
      expiry,
      dte: daysToExpiry(expiry, now),
      kind: classifyExpiry(expiry),
      contracts: contractsCount,
    }))
    .sort((a, b) => a.dte - b.dte);
}

/** Contracts for a single expiry. */
export function contractsForExpiry(contracts: OptionQuote[], expiry: string): OptionQuote[] {
  return contracts.filter((c) => c.expiry === expiry);
}

// ── Volatility smile / skew ─────────────────────────────────────────────────

export type SmilePoint = {
  strike: number;
  callIv: number | null;
  putIv: number | null;
  /** log-moneyness ln(K/S), null when no spot — useful as an x-axis. */
  moneyness: number | null;
};

/**
 * The implied-vol smile for one expiry: call IV and put IV at each strike,
 * ascending. `spot` (optional) annotates each point with log-moneyness. Strikes
 * with no IV on either side are dropped.
 */
export function volatilitySmile(
  contracts: OptionQuote[],
  expiry: string,
  spot: number | null = null,
): SmilePoint[] {
  const calls = new Map<number, number>();
  const puts = new Map<number, number>();
  for (const c of contractsForExpiry(contracts, expiry)) {
    if (c.iv == null || !(c.iv > 0)) continue;
    (c.right === "call" ? calls : puts).set(c.strike, c.iv);
  }
  const strikes = Array.from(new Set([...calls.keys(), ...puts.keys()])).sort((a, b) => a - b);
  return strikes.map((strike) => ({
    strike,
    callIv: calls.get(strike) ?? null,
    putIv: puts.get(strike) ?? null,
    moneyness: spot != null && spot > 0 ? Math.log(strike / spot) : null,
  }));
}

/**
 * At-the-money IV for one expiry: the IV of the strike nearest spot, averaging
 * the call and put side when both are present. Null when no priced strike/spot.
 */
export function atmIv(
  contracts: OptionQuote[],
  expiry: string,
  spot: number | null,
): number | null {
  if (spot == null || !(spot > 0)) return null;
  const rows = contractsForExpiry(contracts, expiry).filter((c) => c.iv != null && c.iv > 0);
  if (!rows.length) return null;
  let nearest = Infinity;
  for (const c of rows) nearest = Math.min(nearest, Math.abs(c.strike - spot));
  const atStrikes = rows.filter((c) => Math.abs(c.strike - spot) === nearest);
  const ivs = atStrikes.map((c) => c.iv as number);
  return ivs.reduce((s, v) => s + v, 0) / ivs.length;
}

/**
 * 25-delta-ish risk reversal proxy for one expiry: (OTM put IV − OTM call IV) at
 * roughly one expected-move out. Positive = puts bid over calls (downside skew,
 * the equity-index norm). Null when we can't find both wings. This is a coarse
 * "which way is the skew leaning" read, not a true delta-interpolated RR.
 */
export function skew25(
  contracts: OptionQuote[],
  expiry: string,
  spot: number | null,
): number | null {
  if (spot == null || !(spot > 0)) return null;
  const smile = volatilitySmile(contracts, expiry, spot);
  if (!smile.length) return null;
  // Target wings ~10% OTM either side; pick the priced strike nearest each.
  const putTarget = spot * 0.9;
  const callTarget = spot * 1.1;
  const put = pickNearest(
    smile.filter((p) => p.putIv != null && p.strike < spot),
    putTarget,
    (p) => p.strike,
  );
  const call = pickNearest(
    smile.filter((p) => p.callIv != null && p.strike > spot),
    callTarget,
    (p) => p.strike,
  );
  if (!put?.putIv || !call?.callIv) return null;
  return put.putIv - call.callIv;
}

function pickNearest<T>(rows: T[], target: number, key: (r: T) => number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const r of rows) {
    const d = Math.abs(key(r) - target);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// ── IV term structure ───────────────────────────────────────────────────────

export type TermPoint = { expiry: string; dte: number; atmIv: number | null; kind: ExpiryKind };

/** ATM IV per expiry across the whole chain, ascending by DTE. */
export function ivTermStructure(
  contracts: OptionQuote[],
  spot: number | null,
  now: Date = new Date(),
): TermPoint[] {
  return listExpiries(contracts, now).map((e) => ({
    expiry: e.expiry,
    dte: e.dte,
    kind: e.kind,
    atmIv: atmIv(contracts, e.expiry, spot),
  }));
}

// ── Open interest / volume positioning ──────────────────────────────────────

export type StrikeFlow = {
  strike: number;
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
};

/** Open interest & volume by strike for one expiry, ascending by strike. */
export function flowByStrike(contracts: OptionQuote[], expiry: string): StrikeFlow[] {
  const map = new Map<number, StrikeFlow>();
  for (const c of contractsForExpiry(contracts, expiry)) {
    const row =
      map.get(c.strike) ?? { strike: c.strike, callOi: 0, putOi: 0, callVol: 0, putVol: 0 };
    if (c.right === "call") {
      row.callOi += c.openInterest ?? 0;
      row.callVol += c.volume ?? 0;
    } else {
      row.putOi += c.openInterest ?? 0;
      row.putVol += c.volume ?? 0;
    }
    map.set(c.strike, row);
  }
  return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
}

export type PutCallStats = {
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
  /** put OI / call OI, null when no call OI. */
  oiRatio: number | null;
  /** put volume / call volume, null when no call volume. */
  volRatio: number | null;
};

/**
 * Aggregate put/call open interest & volume over a set of contracts (pass a
 * single expiry's contracts, or the whole chain). The ratios are the classic
 * sentiment gauges: >1 = more puts than calls (bearish/hedged positioning).
 */
export function putCallStats(contracts: OptionQuote[]): PutCallStats {
  let callOi = 0;
  let putOi = 0;
  let callVol = 0;
  let putVol = 0;
  for (const c of contracts) {
    if (c.right === "call") {
      callOi += c.openInterest ?? 0;
      callVol += c.volume ?? 0;
    } else {
      putOi += c.openInterest ?? 0;
      putVol += c.volume ?? 0;
    }
  }
  return {
    callOi,
    putOi,
    callVol,
    putVol,
    oiRatio: callOi > 0 ? putOi / callOi : null,
    volRatio: callVol > 0 ? putVol / callVol : null,
  };
}

// ── Max pain ────────────────────────────────────────────────────────────────

/**
 * Max-pain strike for one expiry: the strike at which the total intrinsic value
 * of all open contracts (call + put) is smallest — i.e. where the most option
 * value expires worthless. Weighted by open interest. Returns null when no OI.
 *
 * At candidate settle price P, a call struck K is worth max(P−K,0) per share and
 * a put max(K−P,0); we sum over every strike's OI and pick the P minimizing it.
 */
export function maxPain(contracts: OptionQuote[], expiry: string): number | null {
  const rows = flowByStrike(contracts, expiry);
  const strikes = rows.map((r) => r.strike);
  if (!strikes.length) return null;
  const totalOi = rows.reduce((s, r) => s + r.callOi + r.putOi, 0);
  if (totalOi <= 0) return null;

  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const r of rows) {
      if (settle > r.strike) pain += (settle - r.strike) * r.callOi; // calls ITM
      if (settle < r.strike) pain += (r.strike - settle) * r.putOi; // puts ITM
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}

// ── Gamma exposure (GEX) ────────────────────────────────────────────────────

export type GexPoint = { strike: number; gex: number };

/**
 * Dealer gamma exposure by strike for one expiry, in $ per 1% underlying move.
 *
 * Convention: dealers are assumed short calls / long puts against customer flow,
 * so call gamma contributes positively and put gamma negatively to net dealer
 * gamma. GEX_strike = spot² · 0.01 · Σ(γ · OI · 100 · sign). Positive total GEX
 * ⇒ dealers dampen moves (pin), negative ⇒ they amplify. Needs per-contract
 * greeks (CBOE) and OI; strikes lacking gamma contribute 0.
 */
export function gammaExposureByStrike(
  contracts: OptionQuote[],
  expiry: string,
  spot: number | null,
): GexPoint[] {
  if (spot == null || !(spot > 0)) return [];
  const factor = spot * spot * 0.01 * CONTRACT_MULTIPLIER;
  const map = new Map<number, number>();
  for (const c of contractsForExpiry(contracts, expiry)) {
    const gamma = c.greeks?.gamma;
    const oi = c.openInterest;
    if (gamma == null || !Number.isFinite(gamma) || oi == null || oi <= 0) continue;
    const sign = c.right === "call" ? 1 : -1;
    const contribution = sign * gamma * oi * factor;
    map.set(c.strike, (map.get(c.strike) ?? 0) + contribution);
  }
  return Array.from(map.entries())
    .map(([strike, gex]) => ({ strike, gex }))
    .sort((a, b) => a.strike - b.strike);
}

/** Net dealer GEX summed across a set of contracts (single expiry or chain). */
export function totalGex(contracts: OptionQuote[], expiry: string, spot: number | null): number | null {
  const pts = gammaExposureByStrike(contracts, expiry, spot);
  if (!pts.length) return null;
  return pts.reduce((s, p) => s + p.gex, 0);
}

// ── Greek-by-strike (for the selectable per-strike greek chart) ──────────────

export type GreekKey = "delta" | "gamma" | "theta" | "vega";

export type GreekStrikePoint = { strike: number; call: number | null; put: number | null };

/** A chosen greek at each strike for one expiry (call + put side). */
export function greekByStrike(
  contracts: OptionQuote[],
  expiry: string,
  greek: GreekKey,
): GreekStrikePoint[] {
  const calls = new Map<number, number>();
  const puts = new Map<number, number>();
  for (const c of contractsForExpiry(contracts, expiry)) {
    const v = c.greeks?.[greek];
    if (v == null || !Number.isFinite(v)) continue;
    (c.right === "call" ? calls : puts).set(c.strike, v);
  }
  const strikes = Array.from(new Set([...calls.keys(), ...puts.keys()])).sort((a, b) => a - b);
  return strikes.map((strike) => ({
    strike,
    call: calls.get(strike) ?? null,
    put: puts.get(strike) ?? null,
  }));
}

// ── IV surface grid (feeds the 3D canvas) ───────────────────────────────────

export type IvSurface = {
  /** Column axis — expiries ascending by DTE. */
  expiries: { expiry: string; dte: number }[];
  /** Row axis — the union of strikes carrying IV, ascending. */
  strikes: number[];
  /** z[i][j] = IV at strikes[i], expiries[j], or null when absent. */
  z: (number | null)[][];
  spot: number | null;
};

/**
 * Build the (strike × expiry) implied-vol grid for a 3D surface. `side` chooses
 * which contract's IV fills each cell: "call", "put", or "mid" (average when
 * both present). Strikes are limited to `strikeWindow` either side of spot when
 * given, keeping the surface legible; pass null to include every strike.
 */
export function buildIvSurface(
  contracts: OptionQuote[],
  spot: number | null,
  opts: { side?: "call" | "put" | "mid"; strikeWindow?: number | null; now?: Date } = {},
): IvSurface {
  const side = opts.side ?? "mid";
  const now = opts.now ?? new Date();
  const strikeWindow = opts.strikeWindow === undefined ? 12 : opts.strikeWindow;

  const expiries = listExpiries(contracts, now)
    .filter((e) => e.dte >= 0)
    .map((e) => ({ expiry: e.expiry, dte: e.dte }));

  // Collect IV per (strike, expiry) for the chosen side.
  const byExpiry = new Map<string, Map<number, number>>();
  const allStrikes = new Set<number>();
  for (const e of expiries) {
    const calls = new Map<number, number>();
    const puts = new Map<number, number>();
    for (const c of contractsForExpiry(contracts, e.expiry)) {
      if (c.iv == null || !(c.iv > 0)) continue;
      (c.right === "call" ? calls : puts).set(c.strike, c.iv);
    }
    const merged = new Map<number, number>();
    const strikes = new Set([...calls.keys(), ...puts.keys()]);
    for (const k of strikes) {
      const cv = calls.get(k);
      const pv = puts.get(k);
      let v: number | undefined;
      if (side === "call") v = cv;
      else if (side === "put") v = pv;
      else v = cv != null && pv != null ? (cv + pv) / 2 : (cv ?? pv);
      if (v != null && v > 0) {
        merged.set(k, v);
        allStrikes.add(k);
      }
    }
    byExpiry.set(e.expiry, merged);
  }

  let strikes = Array.from(allStrikes).sort((a, b) => a - b);
  if (strikeWindow != null && spot != null && spot > 0 && strikes.length > strikeWindow * 2 + 1) {
    let ci = 0;
    for (let i = 0; i < strikes.length; i++) {
      if (Math.abs(strikes[i] - spot) < Math.abs(strikes[ci] - spot)) ci = i;
    }
    strikes = strikes.slice(Math.max(0, ci - strikeWindow), ci + strikeWindow + 1);
  }

  const z: (number | null)[][] = strikes.map((k) =>
    expiries.map((e) => byExpiry.get(e.expiry)?.get(k) ?? null),
  );

  return { expiries, strikes, z, spot };
}
