/**
 * Manual / imported investment accounts.
 *
 * Plaid `accounts` require an `items` row (the link). Imported trades have no
 * Plaid link, so they hang off a single Plaid-less container item (`manual`) that
 * `syncAllItems` skips. Each imported broker becomes a `source:'manual'` account
 * under that container — a real, non-excluded account, so the tax-lot engine and
 * every investment view treat it exactly like a Plaid account.
 */
import { db } from "@/db";
import { items, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/** The one shared container item for all manual/imported accounts. */
export const MANUAL_ITEM_ID = "manual";

/** Ensure the manual container item exists; idempotent. */
export function ensureManualItem(): string {
  const now = new Date();
  db.insert(items)
    .values({
      id: MANUAL_ITEM_ID,
      accessToken: "", // never used — syncAllItems skips source:'manual'
      institutionName: "Manual & imported",
      status: "active",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: items.id })
    .run();
  return MANUAL_ITEM_ID;
}

export type NewImportAccount = {
  name: string;
  subtype?: string | null; // brokerage | ira | 401k | …
  isoCurrencyCode?: string | null;
};

/** Create a manual investment account for imported trades. Returns its id. */
export function createImportAccount(input: NewImportAccount): string {
  ensureManualItem();
  const id = `manacct_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  db.insert(accounts)
    .values({
      id,
      itemId: MANUAL_ITEM_ID,
      source: "manual",
      name: input.name,
      type: "investment",
      subtype: input.subtype ?? "brokerage",
      isoCurrencyCode: input.isoCurrencyCode ?? "USD",
      excluded: false,
      updatedAt: now,
    })
    .run();
  return id;
}

/** All manual (non-Plaid) accounts, for the import destination picker. */
export function listManualAccounts() {
  return db
    .select({ id: accounts.id, name: accounts.name, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.source, "manual"), eq(accounts.type, "investment")))
    .all();
}
