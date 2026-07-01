/**
 * FX rates — free, no API key (Frankfurter, ECB reference rates).
 *
 *   https://api.frankfurter.app/latest?from=USD
 *
 * Returns `{ base, date, rates: { EUR: 0.92, ... } }`. Fetched with Next's Data
 * Cache (6h — ECB publishes once per working day, so nothing moves intraday) in
 * the same style as lib/yahoo.ts, cached into the `exchange_rates` table, and
 * read back synchronously by the rest of the app to convert any figure whose
 * stored isoCurrencyCode differs from the chosen display currency.
 */

import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Reference the conflicting row's incoming value in an upsert (SQLite `excluded`).
function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

export type RatesMap = Record<string, number>; // quote → (1 base = rate quote)

type FrankfurterLatest = {
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

/**
 * Latest rates for `base` against every quote currency the source publishes.
 * `base` itself is included at 1 so `convert` is total over the map. Returns an
 * empty map on any failure — callers treat a missing rate as identity.
 */
export async function fetchLatestRates(base = "USD"): Promise<RatesMap> {
  const from = base.trim().toUpperCase();
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 21600 }, // 6h
    });
    if (!res.ok) return {};

    const j = (await res.json()) as FrankfurterLatest;
    const rates = j.rates ?? {};

    const out: RatesMap = { [from]: 1 };
    for (const [quote, rate] of Object.entries(rates)) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        out[quote.toUpperCase()] = rate;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Fetch the latest rates for `base` and cache them into `exchange_rates`
 * (one row per pair, upserted). No-op when the source is unreachable so a
 * failed refresh never clobbers a good cache.
 */
export async function upsertRates(base = "USD"): Promise<void> {
  const from = base.trim().toUpperCase();
  const map = await fetchLatestRates(from);
  const asOf = new Date();

  const rows = Object.entries(map).map(([quote, rate]) => ({
    base: from,
    quote,
    rate,
    asOf,
  }));
  if (rows.length === 0) return;

  db.insert(exchangeRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [exchangeRates.base, exchangeRates.quote],
      set: {
        rate: excluded("rate"),
        asOf: excluded("as_of"),
      },
    })
    .run();
}

/**
 * Synchronously read the cached rate map for `base` from the DB. Includes the
 * base itself at 1. Empty when nothing has been cached yet.
 */
export function getCachedRates(base = "USD"): RatesMap {
  const from = base.trim().toUpperCase();
  const rows = db
    .select({ quote: exchangeRates.quote, rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(eq(exchangeRates.base, from))
    .all();

  const out: RatesMap = { [from]: 1 };
  for (const r of rows) out[r.quote.toUpperCase()] = r.rate;
  return out;
}

/**
 * Convert `amount` from `from` currency to `to` currency using a `base`-keyed
 * `ratesMap` (as returned by getCachedRates/fetchLatestRates). Identity when the
 * currencies match or a needed rate is missing, so a partial cache degrades
 * gracefully rather than zeroing figures out.
 */
export function convert(
  amount: number,
  from: string | null | undefined,
  to: string | null | undefined,
  ratesMap: RatesMap,
): number {
  const f = (from ?? "").toUpperCase();
  const t = (to ?? "").toUpperCase();
  if (!f || !t || f === t) return amount;

  // ratesMap is keyed off a single base B: rate[X] = units of X per 1 B.
  // amount(f) → base: amount / rate[f]; base → to: × rate[t].
  const rf = ratesMap[f];
  const rt = ratesMap[t];
  if (!rf || !rt) return amount; // missing leg → identity
  return (amount / rf) * rt;
}
