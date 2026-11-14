/**
 * The holding row shape and the live-valuation rules shared by the Investments
 * tabs. Holdings and Allocation both value positions off the same live quotes;
 * keeping the rules here means the two tabs can't drift into disagreeing about
 * what a position is worth, and Allocation doesn't pull in the whole holdings
 * table to get at three functions.
 */

import { PIE_COLORS } from "@/components/charts";
import { parseOccSymbol } from "@/lib/options";
import type { LiveQuote } from "@/components/portfolio/live-prices";

export type HoldingRow = {
  id: string;
  quantity: number | null;
  costBasis: number | null;
  price: number | null;
  value: number | null;
  closePrice: number | null;
  currency: string | null;
  ticker: string | null;
  securityName: string | null;
  securityType: string | null;
  accountName: string | null;
  /** True for user-entered off-Plaid holdings (crypto, fixed-value assets). */
  manual?: boolean;
  /** True when imported from a connected wallet (quantity is chain-synced). */
  fromWallet?: boolean;
  /** Symbol-scoped key the sector assignment is stored under (see sectorKeyFor). */
  sectorKey: string;
  /** Currently assigned sector, or null when untagged. */
  sector?: string | null;
  /** Brokerage-reported basis before any user correction (Plaid holdings). */
  plaidCostBasis?: number | null;
  /** Raw cost-basis override inputs, for the correction dialog (Plaid holdings). */
  overrideTotal?: number | null;
  overrideUnit?: number | null;
  overrideAsOf?: string | null;
  /** True when `costBasis` reflects a user correction rather than the brokerage figure. */
  hasOverride?: boolean;
};

export const UNASSIGNED = "Unassigned";

/**
 * Effective price for a holding, in priority order:
 *   live Finnhub quote → Plaid institution price → security close price.
 * The closePrice fallback matters for instruments Finnhub can't quote and Plaid
 * leaves without an institution price (e.g. some mutual funds), which would
 * otherwise render as $0.00.
 */
export function effectivePrice(h: HoldingRow, quotes: Record<string, LiveQuote>): number | null {
  const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
  if (q?.price != null) return q.price;
  return h.price ?? h.closePrice ?? null;
}

export function effectiveValue(h: HoldingRow, quotes: Record<string, LiveQuote>): number {
  const price = effectivePrice(h, quotes);
  if (price != null && h.quantity != null) return price * h.quantity;
  return h.value ?? 0;
}

/**
 * Symbols to subscribe to for live quotes. Option (OCC) legs are skipped —
 * Finnhub can't quote them, they're valued from Plaid — but their underlyings
 * are added, because option rows need a spot price for their in-the-money and
 * assignment flags.
 */
export function liveSymbols(holdings: HoldingRow[]): string[] {
  const plain = holdings
    .filter((h) => !parseOccSymbol(h.ticker))
    .map((h) => h.ticker)
    .filter((t): t is string => Boolean(t));
  const underlyings = holdings
    .map((h) => parseOccSymbol(h.ticker)?.underlying)
    .filter((u): u is string => Boolean(u));
  return [...new Set([...plain, ...underlyings])];
}

/**
 * Stable color per sector: indexed by alphabetical name so a sector keeps its
 * hue as live prices reorder it by value. Unassigned is always muted gray.
 */
export function sectorColorMap(sectors: (string | null)[]): Record<string, string> {
  const names = Array.from(
    new Set(sectors.map((s) => s ?? UNASSIGNED).filter((s) => s !== UNASSIGNED)),
  ).sort();
  const map: Record<string, string> = { [UNASSIGNED]: "#8b948c" };
  names.forEach((n, i) => (map[n] = PIE_COLORS[i % PIE_COLORS.length]));
  return map;
}
