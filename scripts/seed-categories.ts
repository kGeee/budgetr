/**
 * Seeds one budgetr category per Plaid `personal_finance_category.primary`.
 * Idempotent — safe to re-run; existing categories (matched by plaidPrimary)
 * are left untouched so user renames/archives survive.
 *
 * Run with: npm run db:seed
 */
import { db } from "@/db";
import { categories } from "@/db/schema";
import { sql } from "drizzle-orm";

type Group = "income" | "spending" | "transfer";

// plaidPrimary, display name, lucide icon name, group, sort order
const SEED: { plaid: string; name: string; icon: string; group: Group }[] = [
  { plaid: "INCOME", name: "Income", icon: "Wallet", group: "income" },
  { plaid: "TRANSFER_IN", name: "Transfer In", icon: "ArrowDownLeft", group: "transfer" },
  { plaid: "TRANSFER_OUT", name: "Transfer Out", icon: "ArrowUpRight", group: "transfer" },
  { plaid: "LOAN_PAYMENTS", name: "Loan Payments", icon: "Landmark", group: "transfer" },
  { plaid: "BANK_FEES", name: "Bank Fees", icon: "Receipt", group: "spending" },
  { plaid: "ENTERTAINMENT", name: "Entertainment", icon: "Clapperboard", group: "spending" },
  { plaid: "FOOD_AND_DRINK", name: "Food & Drink", icon: "UtensilsCrossed", group: "spending" },
  {
    plaid: "GENERAL_MERCHANDISE",
    name: "Shopping",
    icon: "ShoppingBag",
    group: "spending",
  },
  { plaid: "HOME_IMPROVEMENT", name: "Home", icon: "Hammer", group: "spending" },
  { plaid: "MEDICAL", name: "Medical", icon: "HeartPulse", group: "spending" },
  { plaid: "PERSONAL_CARE", name: "Personal Care", icon: "Sparkles", group: "spending" },
  { plaid: "GENERAL_SERVICES", name: "Services", icon: "Wrench", group: "spending" },
  {
    plaid: "GOVERNMENT_AND_NON_PROFIT",
    name: "Government & Charity",
    icon: "Building2",
    group: "spending",
  },
  { plaid: "TRANSPORTATION", name: "Transportation", icon: "Car", group: "spending" },
  { plaid: "TRAVEL", name: "Travel", icon: "Plane", group: "spending" },
  {
    plaid: "RENT_AND_UTILITIES",
    name: "Rent & Utilities",
    icon: "Plug",
    group: "spending",
  },
];

function slug(plaid: string): string {
  return "cat_" + plaid.toLowerCase();
}

let inserted = 0;
for (let i = 0; i < SEED.length; i++) {
  const s = SEED[i];
  const res = db
    .insert(categories)
    .values({
      id: slug(s.plaid),
      name: s.name,
      icon: s.icon,
      group: s.group,
      plaidPrimary: s.plaid,
      sortOrder: i,
      archived: false,
    })
    // Only insert if this plaidPrimary isn't already mapped — never clobber user edits.
    .onConflictDoNothing({ target: categories.plaidPrimary })
    .run();
  inserted += res.changes;
}

const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM categories`)?.n ?? 0;
console.log(`✓ Categories seeded — ${inserted} new, ${total} total`);
