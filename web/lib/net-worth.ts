import {
  getImportedHoldings,
  getManualHoldings,
  getNetWorth,
  getNetWorthSeries,
  type NetWorth,
} from "@/lib/queries";
import { getTickerHistories, type PricePoint } from "@/lib/portfolio-history";
import { parseOccSymbol } from "@/lib/options";
import { readJson, writeJson } from "@/lib/companion/store";

/**
 * All-inclusive net worth: linked account balances plus everything held off
 * Plaid — fixed-value manual assets (an iBond, cash), ticker-carrying manual
 * holdings (BTC-USD, a wallet's SOL-USD) and positions rebuilt from imported
 * broker trades.
 *
 * The account-only figure (getNetWorth) left the ticker-carrying holdings out
 * because valuing them needs a price fetch, so the Investments page — which
 * does price them — showed a bigger number than net worth. Everything that
 * reports a net-worth headline should go through here instead.
 */

/** Latest close per symbol (upper-cased), dollars. */
export type PriceMap = Record<string, number>;

/** A position valued as quantity × a quote; `fallback` is used when no quote. */
export type PricedPosition = { symbol: string; quantity: number; fallback: number | null };

export type OffPlaid = { fixed: number; positions: PricedPosition[] };

/** Off-Plaid holdings from the DB. No prices — cheap and synchronous. */
export function getOffPlaid(): OffPlaid {
  let fixed = 0;
  const positions: PricedPosition[] = [];
  for (const m of getManualHoldings()) {
    if (m.symbol && m.quantity != null) {
      positions.push({ symbol: m.symbol.toUpperCase(), quantity: m.quantity, fallback: m.manualValue });
    } else {
      fixed += m.manualValue ?? 0;
    }
  }
  // Import accounts never carry a balance of their own, so their positions are
  // the only place their value shows up — no double count against getNetWorth.
  // Option (OCC) legs have no Yahoo quote; Investments values them at 0 too.
  for (const h of getImportedHoldings()) {
    if (parseOccSymbol(h.ticker)) continue;
    positions.push({ symbol: h.ticker.toUpperCase(), quantity: h.quantity, fallback: null });
  }
  return { fixed, positions };
}

/** Every symbol that needs a quote. */
export function pricedSymbols(off: OffPlaid = getOffPlaid()): string[] {
  return [...new Set(off.positions.map((p) => p.symbol))];
}

/** Today's off-Plaid value at the given prices. */
export function offPlaidValue(off: OffPlaid, prices: PriceMap): number {
  let total = off.fixed;
  for (const p of off.positions) {
    const px = prices[p.symbol];
    total += px != null ? p.quantity * px : (p.fallback ?? 0);
  }
  return total;
}

/**
 * Add the off-Plaid value to each point of an account-only series. Priced
 * positions use each date's close (the last one on or before it; the first
 * one for dates before the history starts), so crypto moves the line the way
 * it moved the balance; a symbol with no history at all rides at today's price.
 */
export function withOffPlaid(
  series: { date: string; netWorth: number }[],
  off: OffPlaid,
  histories: Record<string, PricePoint[]>,
  prices: PriceMap,
): { date: string; netWorth: number }[] {
  const sorted: Record<string, PricePoint[]> = {};
  for (const [k, v] of Object.entries(histories)) {
    sorted[k.toUpperCase()] = [...v].sort((a, b) => a.date.localeCompare(b.date));
  }
  const cursor: Record<string, number> = {};
  return [...series]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((pt) => {
      let add = off.fixed;
      for (const p of off.positions) {
        const hist = sorted[p.symbol];
        if (hist && hist.length > 0) {
          let i = cursor[p.symbol] ?? 0;
          while (i + 1 < hist.length && hist[i + 1].date <= pt.date) i++;
          cursor[p.symbol] = i;
          add += p.quantity * hist[i].close;
        } else {
          const px = prices[p.symbol];
          add += px != null ? p.quantity * px : (p.fallback ?? 0);
        }
      }
      return { date: pt.date, netWorth: pt.netWorth + add };
    });
}

/**
 * Fill each symbol from this round's quotes, falling back to the last price
 * that ever came back for it. A ticker-carrying holding has no stored value of
 * its own, so one failed quote used to make it vanish until the next good
 * fetch; Yahoo rate-limits often enough that this happened in practice.
 */
export function mergePrices(symbols: string[], fresh: PriceMap, known: PriceMap): PriceMap {
  const out: PriceMap = {};
  for (const raw of symbols) {
    const sym = raw.toUpperCase();
    const px = fresh[sym] ?? known[sym];
    if (typeof px === "number" && Number.isFinite(px) && px > 0) out[sym] = px;
  }
  return out;
}

const LAST_PRICES_KEY = "companion.lastPrices";

/** Price history + latest close for each symbol — the Investments page's source. */
export async function loadPricing(
  symbols: string[],
  months = 12,
): Promise<{ prices: PriceMap; histories: Record<string, PricePoint[]> }> {
  if (symbols.length === 0) return { prices: {}, histories: {} };
  let histories: Record<string, PricePoint[]> = {};
  const fresh: PriceMap = {};
  try {
    histories = await getTickerHistories(symbols, months);
    for (const [sym, hist] of Object.entries(histories)) {
      const last = hist.at(-1)?.close;
      if (typeof last === "number" && Number.isFinite(last)) fresh[sym.toUpperCase()] = last;
    }
  } catch {
    // Offline or rate-limited: fall through to the remembered prices.
  }
  const prices = mergePrices(symbols, fresh, readJson<PriceMap>(LAST_PRICES_KEY) ?? {});
  // Remember only what is still held, so the row never grows without bound.
  if (Object.keys(fresh).length > 0) writeJson(LAST_PRICES_KEY, prices);
  return { prices, histories };
}

export type InclusiveNetWorth = {
  nw: NetWorth;
  series: { date: string; netWorth: number }[];
  prices: PriceMap;
};

/** Net worth and its history with everything off Plaid folded in. */
export async function loadInclusiveNetWorth(): Promise<InclusiveNetWorth> {
  const off = getOffPlaid();
  const { prices, histories } = await loadPricing(pricedSymbols(off));
  const base = getNetWorth();
  const extra = offPlaidValue(off, prices);
  return {
    nw: { assets: base.assets + extra, liabilities: base.liabilities, net: base.net + extra },
    series: withOffPlaid(getNetWorthSeries(), off, histories, prices),
    prices,
  };
}
