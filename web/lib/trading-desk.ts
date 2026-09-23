/**
 * The "Trading desk" preference.
 *
 * budgetr's core is budgeting and personal finance. The trading tools — the
 * Markets watchlist and candles, the Options desk (chain, vol, LEAPS, wheel)
 * and SEC Fundamentals — are real, working tools, but they are not what most
 * people open a budgeting app for, and 0.15 took them out of the everyday
 * navigation. This flag brings them back: off by default, one switch in
 * Settings → Display.
 *
 * The read-only web demo always shows them — it is the showcase.
 *
 * Stored in the `app_settings` KV and read synchronously, like lib/pending.ts.
 * Server-only.
 */

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { demoEnabled } from "@/lib/site";

export const TRADING_DESK_KEY = "tradingDesk";

/** Routes that belong to the desk. The sidebar and holding chips key off this. */
export const TRADING_DESK_ROUTES = ["/markets", "/investments/options", "/fundamentals"] as const;

/** True when the trading tools should be shown. */
export function isTradingDeskEnabled(): boolean {
  if (demoEnabled()) return true;
  const row = db.select().from(appSettings).where(eq(appSettings.key, TRADING_DESK_KEY)).get();
  return row?.value === "1";
}

/** Persist the preference. Off is stored as the absence of the row (the default). */
export function setTradingDeskEnabled(on: boolean): void {
  if (!on) {
    db.delete(appSettings).where(eq(appSettings.key, TRADING_DESK_KEY)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key: TRADING_DESK_KEY, value: "1" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

/**
 * Call at the top of a desk page. With the desk off, a bookmark or an old link
 * lands on the Settings switch that explains where the page went, instead of a
 * 404 or a page the navigation no longer admits exists.
 */
export function requireTradingDesk(): void {
  if (!isTradingDeskEnabled()) redirect("/settings#trading-desk");
}
