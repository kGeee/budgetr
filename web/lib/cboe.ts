/**
 * CBOE delayed option chains — free, no API key, and (unlike Yahoo) it hands
 * back real market Greeks per contract instead of us modelling them:
 *
 *   https://cdn.cboe.com/api/global/delayed_quotes/options/LRCX.json
 *
 * One call returns the underlying quote plus every listed expiry's contracts,
 * each with bid/ask/last, implied vol, open interest, volume, and the full
 * Greek set (delta/gamma/theta/vega/rho) — the OptionStrat-style data set.
 * Delayed ~15m, which is fine for position analytics.
 *
 * We reshape it into the shared `OptionChain` type so it's a drop-in for the
 * Yahoo fetcher (which now needs an auth crumb and can't be called headless).
 * Cached in Next's Data Cache for 30m. A hard failure resolves to null so the
 * caller can fall back.
 */

import { parseOccSymbol } from "./options";
import type { OptionChain, OptionQuote, QuoteGreeks } from "./yahoo";

type CboeOption = {
  option?: string;
  bid?: number;
  ask?: number;
  last_trade_price?: number;
  iv?: number;
  open_interest?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
};

type CboeResponse = {
  data?: {
    current_price?: number;
    close?: number;
    options?: CboeOption[];
  };
};

/** Finite number, else null. */
function n(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Fetch the full CBOE option chain for `underlying`. When `expiries`
 * (YYYY-MM-DD) are given, only those expirations are kept — the delayed feed
 * lists thousands of contracts, and trimming to the expiries we actually hold
 * keeps the payload (and the RSC serialization) small. Returns null on failure.
 */
export async function getCboeOptionChain(
  underlying: string,
  expiries: string[] = [],
): Promise<OptionChain | null> {
  const sym = underlying.trim().toUpperCase();
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(sym)}.json`;
  const wanted = expiries.length ? new Set(expiries) : null;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 1800 }, // 30m
    });
    if (!res.ok) return null;
    const j = (await res.json()) as CboeResponse;
    const d = j.data;
    if (!d?.options?.length) return null;

    const ivByOcc: Record<string, number> = {};
    const contracts: OptionQuote[] = [];
    const expirationSet = new Set<number>();

    for (const o of d.options) {
      const occ = o.option?.toUpperCase();
      if (!occ) continue;
      const parsed = parseOccSymbol(occ);
      if (!parsed) continue;
      if (wanted && !wanted.has(parsed.expiry)) continue;

      const iv = n(o.iv);
      if (iv != null && iv > 0) ivByOcc[occ] = iv;
      expirationSet.add(Date.parse(`${parsed.expiry}T00:00:00Z`) / 1000);

      const greeks: QuoteGreeks = {
        delta: n(o.delta),
        gamma: n(o.gamma),
        theta: n(o.theta),
        vega: n(o.vega),
        rho: n(o.rho),
      };
      const hasGreeks = Object.values(greeks).some((v) => v != null);

      contracts.push({
        occ,
        expiry: parsed.expiry,
        strike: parsed.strike,
        right: parsed.right,
        bid: n(o.bid),
        ask: n(o.ask),
        last: n(o.last_trade_price),
        iv: iv != null && iv > 0 ? iv : null,
        openInterest: n(o.open_interest),
        volume: n(o.volume),
        inTheMoney:
          d.current_price != null
            ? parsed.right === "call"
              ? d.current_price > parsed.strike
              : d.current_price < parsed.strike
            : null,
        greeks: hasGreeks ? greeks : null,
      });
    }

    if (contracts.length === 0) return null;

    return {
      underlyingPrice: n(d.current_price) ?? n(d.close),
      expirations: [...expirationSet].sort((a, b) => a - b),
      ivByOcc,
      contracts,
    };
  } catch {
    return null;
  }
}
