/**
 * Storage for the markets desk's watchlist and chart preferences.
 *
 * Kept in two JSON blobs in the `app_settings` KV table rather than in their own
 * tables: this is a handful of strings and an indicator config for a single-user
 * local app, and a schema migration would buy nothing but a migration.
 *
 * Server-only — it imports the DB. The pure half (types, defaults, validators)
 * lives in lib/markets-prefs.ts so the client can share it.
 *
 * The first time the desk is opened there is no stored list, so it is seeded
 * from whatever the portfolio already holds (see `seedFromHoldings`) — the page
 * is then useful on first paint instead of being an empty grid and a search box.
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
  normalizeSymbol,
  type MarketsPrefs,
} from "@/lib/markets-prefs";

const K_WATCHLIST = "marketsWatchlist";
const K_PREFS = "marketsPrefs";

function read(key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

function write(key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

/** Symbols worth charting that the portfolio already holds, largest first. */
function seedFromHoldings(): string[] {
  const byValue = new Map<string, number>();

  for (const h of getHoldings()) {
    const t = h.ticker?.trim().toUpperCase();
    if (!t) continue;
    if (parseOccSymbol(t)) continue; // option legs chart as their underlying, not as themselves
    if (t.includes(":") || t.includes("/")) continue; // cash/currency pseudo-tickers (CUR:USD)
    if (!normalizeSymbol(t)) continue;
    byValue.set(t, (byValue.get(t) ?? 0) + (h.value ?? 0));
  }

  for (const m of getManualHoldings()) {
    const t = m.symbol?.trim().toUpperCase();
    if (!t || parseOccSymbol(t) || !normalizeSymbol(t)) continue;
    byValue.set(t, (byValue.get(t) ?? 0) + (m.manualValue ?? 0));
  }

  const held = [...byValue.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  // SPY leads the list as the reference the rest are read against, so an empty
  // portfolio still opens onto a usable desk.
  return [...new Set(["SPY", ...held])].slice(0, 12);
}

/** The stored watchlist, seeded from holdings on first use. */
export function getWatchlist(): string[] {
  const raw = read(K_WATCHLIST);
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed
          .filter((s): s is string => typeof s === "string")
          .map(normalizeSymbol)
          .filter((s): s is string => s != null);
        return [...new Set(clean)].slice(0, MAX_WATCHLIST);
      }
    } catch {
      // Corrupt blob — fall through to a fresh seed rather than 500ing the page.
    }
  }
  const seeded = seedFromHoldings();
  write(K_WATCHLIST, JSON.stringify(seeded));
  return seeded;
}

export function setWatchlist(symbols: string[]): string[] {
  const clean = [
    ...new Set(symbols.map(normalizeSymbol).filter((s): s is string => s != null)),
  ].slice(0, MAX_WATCHLIST);
  write(K_WATCHLIST, JSON.stringify(clean));
  return clean;
}

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
