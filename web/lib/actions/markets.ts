"use server";

import { revalidatePath } from "next/cache";
import { getWatchlist, setMarketsPrefs, setWatchlist } from "@/lib/watchlist";
import { MAX_WATCHLIST, normalizeSymbol, type MarketsPrefs } from "@/lib/markets-prefs";
import { getBars } from "@/lib/yahoo";

/**
 * Server Actions for the markets desk — watchlist membership and the chart /
 * Hull preferences. Both live in the `app_settings` KV table (see
 * lib/watchlist.ts), so these are thin wrappers whose real job is validation and
 * revalidating the desk.
 *
 * Only `/markets` is revalidated, not the root layout: nothing in the sidebar or
 * any other page reads the watchlist, so a wider invalidation would just make
 * every force-dynamic page re-query for nothing.
 */

export type AddSymbolResult = { ok: true; symbols: string[] } | { ok: false; error: string };

/**
 * Add a symbol, verifying it actually resolves before storing it. The check
 * matters more here than elsewhere: a typo'd ticker would otherwise sit in the
 * grid forever as a permanently empty chart with no explanation.
 */
export async function addWatchlistSymbol(raw: string): Promise<AddSymbolResult> {
  const sym = normalizeSymbol(raw);
  if (!sym) return { ok: false, error: "That doesn't look like a ticker." };

  const current = getWatchlist();
  if (current.includes(sym)) return { ok: true, symbols: current };
  if (current.length >= MAX_WATCHLIST) {
    return { ok: false, error: `The watchlist holds ${MAX_WATCHLIST} symbols. Remove one first.` };
  }

  const { bars } = await getBars(sym, "1mo", "1d");
  if (bars.length === 0) return { ok: false, error: `No price history for ${sym}.` };

  const symbols = setWatchlist([...current, sym]);
  revalidatePath("/markets");
  return { ok: true, symbols };
}

export async function removeWatchlistSymbol(raw: string): Promise<string[]> {
  const sym = normalizeSymbol(raw);
  const symbols = setWatchlist(getWatchlist().filter((s) => s !== sym));
  revalidatePath("/markets");
  return symbols;
}

/** Persist a reordered list (drag-to-reorder in the rail). */
export async function reorderWatchlist(symbols: string[]): Promise<string[]> {
  const next = setWatchlist(symbols);
  revalidatePath("/markets");
  return next;
}

/**
 * Persist chart + Hull preferences. Not revalidated: the client already holds
 * the new prefs and re-renders from them, so this write only has to make the
 * choice survive a reload.
 */
export async function saveMarketsPrefs(prefs: MarketsPrefs): Promise<void> {
  setMarketsPrefs(prefs);
}
