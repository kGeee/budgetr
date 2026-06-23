import { db } from "@/db";
import { tagRules } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Apply auto-tag rules — attach each rule's tag to every transaction whose
 * merchant or raw name contains the rule's (lowercased) pattern. Idempotent
 * via INSERT OR IGNORE against the transaction_tags composite key.
 *
 * Pass `transactionIds` to scope to just-synced rows; omit to backfill all.
 * Shared by `lib/sync.ts` (new transactions) and `lib/actions.ts` (rule creation).
 * Returns the number of (transaction, tag) links created.
 */
export function applyTagRules(transactionIds?: string[]): number {
  const rules = db.select().from(tagRules).all();
  if (rules.length === 0) return 0;

  const scoped = transactionIds && transactionIds.length > 0;
  const idFilter = scoped
    ? sql`AND t.id IN (${sql.join(
        transactionIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  let created = 0;
  for (const rule of rules) {
    const like = `%${rule.pattern}%`;
    const res = db.run(sql`
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
      SELECT t.id, ${rule.tagId} FROM transactions t
      WHERE (lower(COALESCE(t.merchant_name, '')) LIKE ${like}
          OR lower(t.name) LIKE ${like})
        ${idFilter}`);
    created += (res as { changes: number }).changes;
  }
  return created;
}
