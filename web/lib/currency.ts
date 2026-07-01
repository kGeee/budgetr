/**
 * Display-currency preference.
 *
 * budgetr stores every figure in its source `isoCurrencyCode` (whatever Plaid /
 * the brokerage reported). This module holds the single *display* currency the
 * user wants everything shown in; `formatMoney` (lib/utils.ts) converts a
 * figure from its source currency to this one via the cached FX rates before
 * formatting.
 *
 * Mirrors lib/scale.ts: the value is the single source of truth held in the
 * `cur` cookie, kept in module scope so each runtime keeps its own copy —
 *   • Server — set per request in the root layout from the cookie, before the
 *     page's server components format anything.
 *   • Client — set by <CurrencyInit> during render, before any currency renders,
 *     so hydrated output matches the server HTML (no mismatch).
 */

export const CURRENCY_COOKIE = "cur";
export const DEFAULT_CURRENCY = "USD";

/** Currencies offered in the switcher (ISO 4217). USD is always the FX base. */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "INR",
] as const;

let displayCurrency: string = DEFAULT_CURRENCY;

function normalize(code: string | undefined | null): string {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : DEFAULT_CURRENCY;
}

export function setDisplayCurrency(code: string | undefined | null): void {
  displayCurrency = normalize(code);
}

export function getDisplayCurrency(): string {
  return displayCurrency;
}

/** Parse the cookie value into a usable ISO code (defaults to USD). */
export function currencyFromCookie(value: string | undefined): string {
  return normalize(value);
}

// ── Rates map (module scope, client-safe) ─────────────────────────────────────
// Kept here (not in lib/rates.ts, which imports the DB) so both server and
// client bundles can convert figures without pulling better-sqlite3. Seeded per
// request in the root layout from the cached DB rows, and on the client by
// <CurrencyInit>, exactly like the display currency itself.

export const RATES_BASE = "USD"; // the FX base all cached rates are keyed off

// quote → units of quote per 1 RATES_BASE. Always includes the base at 1.
let ratesMap: Record<string, number> = { [RATES_BASE]: 1 };

export function setRatesMap(map: Record<string, number>): void {
  ratesMap = { [RATES_BASE]: 1, ...map };
}

export function getRatesMap(): Record<string, number> {
  return ratesMap;
}

/**
 * Convert `amount` from `from` currency to the active display currency using
 * the seeded rate map. Identity when the currencies match or a needed rate is
 * missing, so a partial/empty cache degrades gracefully rather than zeroing
 * figures out. Pure arithmetic — safe on both server and client.
 */
export function convertToDisplay(amount: number, from: string | null | undefined): number {
  const f = (from ?? "").toUpperCase();
  const t = displayCurrency;
  if (!f || f === t) return amount;

  const rf = ratesMap[f];
  const rt = ratesMap[t];
  if (!rf || !rt) return amount; // missing leg → identity
  return (amount / rf) * rt;
}
