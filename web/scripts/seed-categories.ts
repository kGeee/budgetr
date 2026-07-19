/**
 * Seeds one budgetr category per Plaid `personal_finance_category.primary`.
 * Idempotent — safe to re-run; existing categories (matched by plaidPrimary)
 * are left untouched so user renames/archives survive.
 *
 * The taxonomy + seed logic live in lib/seed-categories-data.ts so the same code
 * runs both here and in the in-app first-run demo seed. Run with: npm run db:seed
 */
import { seedCategories, categoryCount } from "@/lib/seed-categories-data";

const inserted = seedCategories();
console.log(`✓ Categories seeded — ${inserted} new, ${categoryCount()} total`);
