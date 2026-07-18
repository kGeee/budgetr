/**
 * Auto-detect the corporate actions an imported history needs. Manual entry is
 * the floor; this fetches known splits from Yahoo for the imported tickers and
 * suggests the ones not already recorded, so a user importing years of history
 * doesn't have to remember every split themselves.
 */
import { getSplitEvents, type SplitEvent } from "@/lib/yahoo";
import type { StockSplit } from "@/lib/import/splits";

export type SplitSuggestion = SplitEvent & { ticker: string };

/** Splits from a data source that aren't already recorded for this ticker — pure. */
export function newSplits(ticker: string, fetched: SplitEvent[], existing: StockSplit[]): SplitSuggestion[] {
  const T = ticker.toUpperCase();
  const have = new Set(existing.filter((e) => e.ticker.toUpperCase() === T).map((e) => e.date));
  return fetched.filter((s) => !have.has(s.date)).map((s) => ({ ...s, ticker: T }));
}

/** Only plain equity tickers can be auto-split-checked (skip OCC option symbols). */
export function isEquityTicker(t: string): boolean {
  return /^[A-Z][A-Z.]{0,5}$/.test(t.toUpperCase());
}

/** Fetch + diff splits for a set of tickers against what's already recorded. */
export async function detectSplits(tickers: string[], existing: StockSplit[]): Promise<SplitSuggestion[]> {
  const equity = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(isEquityTicker);
  const out: SplitSuggestion[] = [];
  for (const t of equity) {
    const fetched = await getSplitEvents(t);
    out.push(...newSplits(t, fetched, existing));
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date));
}
