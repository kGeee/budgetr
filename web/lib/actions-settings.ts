"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { CURRENCY_COOKIE, currencyFromCookie } from "@/lib/currency";
import { upsertRates } from "@/lib/rates";

/**
 * Settings server actions — the display-currency preference and the FX-rate
 * refresh that backs it. Like the rest of budgetr's mutations these write to the
 * local SQLite DB (+ the currency cookie, mirroring lib/scale.ts's cookie) and
 * revalidate the whole app so every server component re-reads the new state.
 */

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Refresh + cache the latest USD-based FX rates (no-op if the source is down). */
export async function refreshRates(): Promise<void> {
  await upsertRates("USD");
  revalidatePath("/", "layout");
}

/**
 * Persist the display currency: write it to both the cookie (so the layout can
 * seed module state before render) and the `app_settings` KV (durable source of
 * truth), then refresh the FX cache so figures can convert immediately.
 */
export async function setDisplayCurrency(code: string): Promise<void> {
  const currency = currencyFromCookie(code);

  const store = await cookies();
  store.set(CURRENCY_COOKIE, currency, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

  db.insert(appSettings)
    .values({ key: "displayCurrency", value: currency })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`excluded."value"` },
    })
    .run();

  await upsertRates("USD");
  revalidatePath("/", "layout");
}
