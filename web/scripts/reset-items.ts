/**
 * Reset linked Plaid items — deletes every connected institution and all of its
 * Plaid-owned data (accounts, transactions, holdings, securities links, balance
 * snapshots, recurring streams) via ON DELETE CASCADE.
 *
 * Use this when switching PLAID_ENV (e.g. sandbox -> production): Plaid access
 * tokens are environment-scoped, so sandbox links become invalid and must be
 * re-created. Your user overlay (categories, budgets, tags, tag rules) is
 * independent of items and is preserved.
 *
 * Run with: npm run db:reset-items
 */
import { db } from "@/db";
import { items, securities } from "@/db/schema";

const linked = db.select().from(items).all();

if (linked.length === 0) {
  console.log("No linked items to reset. Nothing to do.");
  process.exit(0);
}

console.log(`Removing ${linked.length} linked item(s):`);
for (const i of linked) {
  console.log(`  - ${i.institutionName ?? i.id} (linked under PLAID_ENV=${i.plaidEnv ?? "unknown"})`);
}

// Cascades to accounts -> transactions / holdings / balance_snapshots /
// recurring_streams. Securities are not FK-bound to accounts, so clear them
// explicitly to avoid leaving orphaned rows.
db.delete(items).run();
db.delete(securities).run();

console.log("✓ Reset complete. Re-link your accounts with the Connect button.");
process.exit(0);
