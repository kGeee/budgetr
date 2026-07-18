/**
 * Security identity for imported trades.
 *
 * The tax-lot engine links a trade to a ticker only through
 * `investment_transactions.security_id` → `securities.tickerSymbol`. There is no
 * symbol-based lookup and no dedupe on ticker, so two `securities` rows with the
 * same ticker would fragment the holdings/dividend joins. We avoid that by giving
 * every imported security a DETERMINISTIC id derived from its symbol, so
 * find-or-create is idempotent and every import of "AAPL" resolves to one row.
 *
 * For options the symbol must be the full OCC contract (e.g. SPXW240119C05000000)
 * because §1256 detection regexes the ticker — never a bare "SPX".
 */
import { db } from "@/db";
import { securities } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Canonical, collision-free id for an imported security: `sym:AAPL`. */
export function importSecurityId(symbol: string): string {
  return `sym:${symbol.trim().toUpperCase()}`;
}

export type ImportSecurity = {
  /** Ticker (equity) or full OCC contract symbol (option). Required. */
  symbol: string;
  name?: string | null;
  type?: string | null; // equity | option | etf | mutual fund | …
  closePrice?: number | null;
  isoCurrencyCode?: string | null;
};

/**
 * Ensure a `securities` row exists for this symbol and return its id. Idempotent:
 * the deterministic `sym:` id means repeated imports upsert one canonical row
 * rather than accumulating duplicates. Only fills name/type when we have them, so
 * a later Plaid sync or a richer import can enrich a bare row without clobbering.
 */
export function findOrCreateSecurity(sec: ImportSecurity): string {
  const symbol = sec.symbol.trim().toUpperCase();
  const id = importSecurityId(symbol);

  // Enrich only — never null out fields a previous import/sync populated.
  const enrich: Partial<{ name: string; type: string; closePrice: number }> = {};
  if (sec.name) enrich.name = sec.name;
  if (sec.type) enrich.type = sec.type;
  if (sec.closePrice != null) enrich.closePrice = sec.closePrice;

  const insert = db.insert(securities).values({
    id,
    tickerSymbol: symbol,
    name: sec.name ?? null,
    type: sec.type ?? null,
    closePrice: sec.closePrice ?? null,
    isoCurrencyCode: sec.isoCurrencyCode ?? null,
  });

  // drizzle rejects an empty `set:`, so when there's nothing to enrich (common
  // for CSV rows that carry no security name) just leave the existing row.
  if (Object.keys(enrich).length > 0) {
    insert.onConflictDoUpdate({ target: securities.id, set: enrich }).run();
  } else {
    insert.onConflictDoNothing({ target: securities.id }).run();
  }

  return id;
}

/** Look up an existing security id by symbol without creating one. */
export function findSecurityId(symbol: string): string | null {
  const id = importSecurityId(symbol);
  const row = db.select({ id: securities.id }).from(securities).where(eq(securities.id, id)).get();
  return row?.id ?? null;
}
