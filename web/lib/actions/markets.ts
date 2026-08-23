"use server";

import { revalidatePath } from "next/cache";
import {
  clearSymbolSource,
  getWatchlist,
  hideWatchlistSymbol,
  pinWatchlistSymbol,
  setMarketsPrefs,
  setSymbolSource,
  setWatchlist,
} from "@/lib/watchlist";
import { MAX_WATCHLIST, normalizeSymbol, type MarketsPrefs, type SymbolSources } from "@/lib/markets-prefs";
import { getBars, searchSymbols, type SymbolMatch } from "@/lib/yahoo";

/**
 * Server Actions for the markets desk — watchlist membership, the source a
 * symbol's data is fetched under, and the chart / Hull preferences. All three
 * live in the `app_settings` KV table (see lib/watchlist.ts), so these are thin
 * wrappers whose real job is validation and revalidating the desk.
 *
 * Only `/markets` is revalidated, not the root layout: nothing in the sidebar or
 * any other page reads the watchlist, so a wider invalidation would just make
 * every force-dynamic page re-query for nothing.
 */

export type AddSymbolResult =
  | { ok: true; symbols: string[] }
  /** `suggestions` is populated when the symbol was valid but had no data. */
  | { ok: false; error: string; suggestions?: SymbolMatch[] };

/**
 * Add a symbol, verifying it actually resolves before storing it. The check
 * matters more here than elsewhere: a typo'd ticker would otherwise sit in the
 * grid forever as a permanently empty chart with no explanation. When it
 * doesn't resolve we search rather than just refusing — "AAPL.L doesn't chart,
 * did you mean AAPL?" is a more useful answer than "no".
 */
export async function addWatchlistSymbol(raw: string): Promise<AddSymbolResult> {
  const sym = normalizeSymbol(raw);
  if (!sym) {
    // Not a ticker shape at all — but it may well be a company name, which is
    // exactly what the search endpoint is for.
    const suggestions = await searchSymbols(raw);
    return suggestions.length
      ? { ok: false, error: `No ticker "${raw.trim()}". Did you mean one of these?`, suggestions }
      : { ok: false, error: "That doesn't look like a ticker." };
  }

  const current = getWatchlist();
  if (current.includes(sym)) return { ok: true, symbols: current };
  if (current.length >= MAX_WATCHLIST) {
    return { ok: false, error: `The desk holds ${MAX_WATCHLIST} symbols. Remove one first.` };
  }

  const { bars } = await getBars(sym, "1mo", "1d");
  if (bars.length === 0) {
    const suggestions = (await searchSymbols(sym)).filter((m) => m.symbol !== sym);
    return {
      ok: false,
      error: `No price history for ${sym}.`,
      suggestions: suggestions.length ? suggestions : undefined,
    };
  }

  const symbols = pinWatchlistSymbol(sym);
  revalidatePath("/markets");
  return { ok: true, symbols };
}

export async function removeWatchlistSymbol(raw: string): Promise<string[]> {
  const sym = normalizeSymbol(raw);
  if (!sym) return getWatchlist();
  const symbols = hideWatchlistSymbol(sym);
  revalidatePath("/markets");
  return symbols;
}

/** Persist a reordered list (drag-to-reorder in the rail). */
export async function reorderWatchlist(symbols: string[]): Promise<string[]> {
  const next = setWatchlist(symbols);
  revalidatePath("/markets");
  return next;
}

// ── symbol sources ──────────────────────────────────────────────────────────

/**
 * Candidates for a symbol the desk couldn't chart. Seeded with the symbol
 * itself, since a search for `BRKB` surfaces `BRK-B` and a search for a token
 * name surfaces its `-USD` pair.
 */
export async function searchMarketSymbols(query: string): Promise<SymbolMatch[]> {
  return searchSymbols(query);
}

export type SetSourceResult =
  | { ok: true; sources: SymbolSources }
  | { ok: false; error: string };

/**
 * Point a symbol at a different source. Verified before it's stored — swapping
 * one blank chart for another blank chart isn't a fix, and the user has no way
 * to tell the difference until the grid repaints.
 */
export async function setMarketSymbolSource(rawSymbol: string, rawSource: string): Promise<SetSourceResult> {
  const symbol = normalizeSymbol(rawSymbol);
  const source = normalizeSymbol(rawSource);
  if (!symbol || !source) return { ok: false, error: "That doesn't look like a ticker." };

  if (symbol === source) {
    const sources = clearSymbolSource(symbol);
    revalidatePath("/markets");
    return { ok: true, sources };
  }

  const { bars } = await getBars(source, "1mo", "1d");
  if (bars.length === 0) return { ok: false, error: `No price history for ${source} either.` };

  const sources = setSymbolSource(symbol, source);
  revalidatePath("/markets");
  return { ok: true, sources };
}

export async function clearMarketSymbolSource(rawSymbol: string): Promise<SymbolSources> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return {};
  const sources = clearSymbolSource(symbol);
  revalidatePath("/markets");
  return sources;
}

/**
 * Persist chart + Hull preferences. Not revalidated: the client already holds
 * the new prefs and re-renders from them, so this write only has to make the
 * choice survive a reload.
 */
export async function saveMarketsPrefs(prefs: MarketsPrefs): Promise<void> {
  setMarketsPrefs(prefs);
}
