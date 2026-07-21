/**
 * The default category taxonomy — one budgetr category per Plaid
 * `personal_finance_category.primary` — plus a reusable seeder.
 *
 * Extracted from scripts/seed-categories.ts so the same taxonomy can be seeded
 * both from the CLI (`npm run db:seed`) and in-app (the first-run demo seed,
 * which needs categories present before it can attach budgets). Server-only.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";

type Group = "income" | "spending" | "transfer";

// plaidPrimary, display name, lucide icon name, group. Sort order is the index.
export const CATEGORY_SEED: { plaid: string; name: string; icon: string; group: Group }[] = [
  { plaid: "INCOME", name: "Income", icon: "Wallet", group: "income" },
  { plaid: "TRANSFER_IN", name: "Transfer In", icon: "ArrowDownLeft", group: "transfer" },
  { plaid: "TRANSFER_OUT", name: "Transfer Out", icon: "ArrowUpRight", group: "transfer" },
  { plaid: "LOAN_PAYMENTS", name: "Loan Payments", icon: "Landmark", group: "transfer" },
  { plaid: "BANK_FEES", name: "Bank Fees", icon: "Receipt", group: "spending" },
  { plaid: "ENTERTAINMENT", name: "Entertainment", icon: "Clapperboard", group: "spending" },
  { plaid: "FOOD_AND_DRINK", name: "Food & Drink", icon: "UtensilsCrossed", group: "spending" },
  { plaid: "GENERAL_MERCHANDISE", name: "Shopping", icon: "ShoppingBag", group: "spending" },
  { plaid: "HOME_IMPROVEMENT", name: "Home", icon: "Hammer", group: "spending" },
  { plaid: "MEDICAL", name: "Medical", icon: "HeartPulse", group: "spending" },
  { plaid: "PERSONAL_CARE", name: "Personal Care", icon: "Sparkles", group: "spending" },
  { plaid: "GENERAL_SERVICES", name: "Services", icon: "Wrench", group: "spending" },
  { plaid: "GOVERNMENT_AND_NON_PROFIT", name: "Government & Charity", icon: "Building2", group: "spending" },
  { plaid: "TRANSPORTATION", name: "Transportation", icon: "Car", group: "spending" },
  { plaid: "TRAVEL", name: "Travel", icon: "Plane", group: "spending" },
  { plaid: "RENT_AND_UTILITIES", name: "Rent & Utilities", icon: "Plug", group: "spending" },
];

export function categorySlug(plaid: string): string {
  return "cat_" + plaid.toLowerCase();
}

/**
 * The holding category for money fronted on behalf of other people (see the
 * shared-expenses tables in db/schema.ts). It maps to no Plaid primary — nothing
 * lands here automatically; only the bill splitter and settlement flow assign it.
 *
 * The `transfer` group is what makes the accounting work: every spend/income
 * query in lib/queries.ts skips that group, so the reimbursable slice of a split
 * bill drops out of your category spend and the repayment inflows don't read as
 * income. Seeded by fixed id (not plaidPrimary, which is null here).
 */
export const REIMBURSABLE_CATEGORY_ID = "cat_reimbursable";

export function seedReimbursableCategory(): number {
  return db
    .insert(categories)
    .values({
      id: REIMBURSABLE_CATEGORY_ID,
      name: "Reimbursable",
      icon: "Users",
      group: "transfer",
      plaidPrimary: null,
      sortOrder: CATEGORY_SEED.length,
      archived: false,
    })
    .onConflictDoNothing({ target: categories.id })
    .run().changes;
}

/**
 * Idempotent category seed — inserts any missing plaidPrimary, never clobbering
 * an existing mapping (so user renames/archives survive). Returns how many rows
 * were newly inserted.
 */
export function seedCategories(): number {
  let inserted = 0;
  for (let i = 0; i < CATEGORY_SEED.length; i++) {
    const s = CATEGORY_SEED[i];
    const res = db
      .insert(categories)
      .values({
        id: categorySlug(s.plaid),
        name: s.name,
        icon: s.icon,
        group: s.group,
        plaidPrimary: s.plaid,
        sortOrder: i,
        archived: false,
      })
      .onConflictDoNothing({ target: categories.plaidPrimary })
      .run();
    inserted += res.changes;
  }
  return inserted + seedReimbursableCategory();
}

/** Number of categories currently in the table. */
export function categoryCount(): number {
  return db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM categories`)?.n ?? 0;
}
