/**
 * The "count pending transactions" preference.
 *
 * By default budgetr only counts *settled* transactions toward spending: a
 * pending charge can still change before it posts — a gas-station
 * pre-authorization holds a round amount that is replaced by the real fill, and
 * a restaurant tab posts again with the tip added. Excluding them keeps history
 * stable.
 *
 * In practice the pending amount is usually the right one, and excluding it
 * makes the last day or two of spending look artificially low. This preference
 * flips every spend total (category spend, budgets, cashflow, vendors, daily
 * spend, reports) to include pending rows, so both readings are one click apart.
 *
 * Stored in the `app_settings` KV, read synchronously at query time — like
 * lib/app-config.ts — so no query signature has to thread it through. Server-only.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const INCLUDE_PENDING_KEY = "includePending";

/** True when pending transactions should count toward spending totals. */
export function getIncludePending(): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, INCLUDE_PENDING_KEY)).get();
  return row?.value === "1";
}

/** Persist the preference. Off is stored as the absence of the row (the default). */
export function setIncludePending(on: boolean): void {
  if (!on) {
    db.delete(appSettings).where(eq(appSettings.key, INCLUDE_PENDING_KEY)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key: INCLUDE_PENDING_KEY, value: "1" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

/**
 * SQL predicate for "this row counts toward spending" — `<alias>.pending = 0`
 * normally, and an always-true predicate when the user has opted to count
 * pending. Alias-parameterized like effectiveCatId/isConfirmedMatch; pass ""
 * for an unaliased `FROM transactions`.
 *
 * Reads the preference per call: it's a primary-key lookup on a two-column
 * table via better-sqlite3, far cheaper than threading a flag through every
 * query signature.
 */
export function settledOnly(alias = "t"): ReturnType<typeof sql> {
  if (getIncludePending()) return sql`1 = 1`;
  return sql`${sql.raw(alias ? `${alias}.pending` : "pending")} = 0`;
}
