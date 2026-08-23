/**
 * Storage for the markets desk's watchlist, chart preferences, and symbol
 * sources.
 *
 * Kept in JSON blobs in the `app_settings` KV table rather than in their own
 * tables: this is a handful of strings and an indicator config for a single-user
 * local app, and a schema migration would buy nothing but a migration.
 *
 * Server-only — it imports the DB. The pure half (types, defaults, validators)
 * lives in lib/markets-prefs.ts so the client can share it.
 *
 * ## The watchlist is derived, not stored
 *
 * The desk's job is to chart what you're actually invested in, so the list is
 * recomputed from holdings on every read rather than seeded once and frozen —
 * a position opened this morning is on the desk this morning, and one that's
 * been sold falls off. What *is* stored is the two things holdings can't say:
 * `pinned` (symbols you asked for that you may not hold — SPY as a reference,
 * something you're watching before buying) and `hidden` (held symbols you've
 * dismissed, which must stay dismissed or every removal would undo itself on
 * the next render).
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { getHoldings, getManualHoldings } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import {
  DEFAULT_PREFS,
  MAX_WATCHLIST,
  coercePrefs,
  composeWatchlist,
  normalizeSymbol,
  type MarketsPrefs,
  type SymbolSources,
} from "@/lib/markets-prefs";

const K_WATCHLIST = "marketsWatchlist";
const K_PREFS = "marketsPrefs";
const K_SOURCES = "marketsSymbolSources";

/** The reference the rest of the desk is read against, on a fresh install. */
const DEFAULT_PINNED = ["SPY"];

function read(key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

function write(key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

function cleanSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const clean = input
    .filter((s): s is string => typeof s === "string")
    .map(normalizeSymbol)
    .filter((s): s is string => s != null);
  return [...new Set(clean)];
}

// ── held symbols ────────────────────────────────────────────────────────────

/**
 * Every chartable symbol the portfolio holds, largest exposure first.
 *
 * Option legs resolve to their underlying rather than being dropped: a NVDA
 * call is a NVDA position as far as a chart is concerned, and the OCC symbol
 * itself has no price history to draw. Exposure is summed on the absolute
 * value so a short leg still earns its underlying a place on the desk.
 */
export function getHeldSymbols(): string[] {
  const byValue = new Map<string, number>();

  const add = (raw: string | null | undefined, value: number | null | undefined) => {
    const t = raw?.trim().toUpperCase();
    if (!t) return;
    const occ = parseOccSymbol(t);
    const sym = occ ? occ.underlying : t;
    // Cash and currency pseudo-tickers (CUR:USD, USD/CAD) aren't markets.
    if (sym.includes(":") || sym.includes("/")) return;
    if (!normalizeSymbol(sym)) return;
    byValue.set(sym, (byValue.get(sym) ?? 0) + Math.abs(value ?? 0));
  };

  for (const h of getHoldings()) {
    if (h.securityType === "cash") continue;
    add(h.ticker, h.value);
  }
  for (const m of getManualHoldings()) {
    if (m.type === "cash") continue;
    add(m.symbol, m.manualValue);
  }

  return [...byValue.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

// ── watchlist state ─────────────────────────────────────────────────────────

export type WatchlistState = { pinned: string[]; hidden: string[] };

function readState(): WatchlistState {
  const raw = read(K_WATCHLIST);
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw);
      // Pre-derivation blobs stored a bare array — the whole visible list, part
      // holdings-seed and part hand-added. Everything in it stays pinned; the
      // holdings half is simply re-derived alongside it from now on.
      if (Array.isArray(parsed)) return { pinned: cleanSymbols(parsed), hidden: [] };
      if (parsed && typeof parsed === "object") {
        const o = parsed as Record<string, unknown>;
        return { pinned: cleanSymbols(o.pinned), hidden: cleanSymbols(o.hidden) };
      }
    } catch {
      // Corrupt blob — fall through to the default rather than 500ing the page.
    }
  }
  const seeded: WatchlistState = { pinned: [...DEFAULT_PINNED], hidden: [] };
  write(K_WATCHLIST, JSON.stringify(seeded));
  return seeded;
}

function writeState(state: WatchlistState): void {
  write(K_WATCHLIST, JSON.stringify(state));
}

/**
 * The desk's symbols: pinned first (in the order they were pinned), then
 * everything held by descending exposure, minus anything dismissed.
 *
 * `derived` is the subset that's on the desk only because the portfolio holds
 * it — the page uses it to explain a removal ("this is a position you hold")
 * rather than to change what's shown. Returned together so the page doesn't
 * walk every holding twice to learn both.
 */
export function getDesk(): { symbols: string[]; derived: string[] } {
  const { pinned, hidden } = readState();
  const explicit = new Set(pinned);
  const symbols = composeWatchlist(pinned, getHeldSymbols(), hidden);
  return { symbols, derived: symbols.filter((s) => !explicit.has(s)) };
}

export function getWatchlist(): string[] {
  return getDesk().symbols;
}

/** Pin a symbol (and un-dismiss it, if it was a held one you'd removed). */
export function pinWatchlistSymbol(symbol: string): string[] {
  const { pinned, hidden } = readState();
  if (!pinned.includes(symbol)) pinned.push(symbol);
  writeState({ pinned, hidden: hidden.filter((s) => s !== symbol) });
  return getWatchlist();
}

/**
 * Drop a symbol from the desk. Unpinning alone isn't enough for a held symbol —
 * it would be re-derived on the next read — so it's also recorded as dismissed.
 */
export function hideWatchlistSymbol(symbol: string): string[] {
  const { pinned, hidden } = readState();
  writeState({
    pinned: pinned.filter((s) => s !== symbol),
    hidden: hidden.includes(symbol) ? hidden : [...hidden, symbol],
  });
  return getWatchlist();
}

/**
 * Persist an explicit ordering. Everything given becomes pinned, since the
 * order of a derived list is exposure, not preference, and can't be stored
 * any other way.
 */
export function setWatchlist(symbols: string[]): string[] {
  const clean = cleanSymbols(symbols).slice(0, MAX_WATCHLIST);
  const { hidden } = readState();
  const visible = new Set(clean);
  writeState({ pinned: clean, hidden: hidden.filter((s) => !visible.has(s)) });
  return getWatchlist();
}

// ── symbol sources ──────────────────────────────────────────────────────────

/** Stored display-symbol → source-symbol redirects. See `sourceFor`. */
export function getSymbolSources(): SymbolSources {
  const raw = read(K_SOURCES);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SymbolSources = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const from = normalizeSymbol(k);
      const to = typeof v === "string" ? normalizeSymbol(v) : null;
      // A symbol that maps to itself is not a redirect; drop it so the UI
      // doesn't show a "via X" chip that means nothing.
      if (from && to && from !== to) out[from] = to;
    }
    return out;
  } catch {
    return {};
  }
}

export function setSymbolSource(symbol: string, source: string): SymbolSources {
  const next = { ...getSymbolSources(), [symbol]: source };
  write(K_SOURCES, JSON.stringify(next));
  return getSymbolSources();
}

export function clearSymbolSource(symbol: string): SymbolSources {
  const next = getSymbolSources();
  delete next[symbol];
  write(K_SOURCES, JSON.stringify(next));
  return next;
}

// ── prefs ───────────────────────────────────────────────────────────────────

export function getMarketsPrefs(): MarketsPrefs {
  const raw = read(K_PREFS);
  if (!raw) return DEFAULT_PREFS;
  try {
    return coercePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setMarketsPrefs(prefs: unknown): MarketsPrefs {
  const clean = coercePrefs(prefs);
  write(K_PREFS, JSON.stringify(clean));
  return clean;
}
