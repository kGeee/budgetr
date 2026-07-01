import { db } from "@/db";
import { tagRules, type TagRule } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Apply auto-tag rules — attach each rule's tag (and, when set, its category)
 * to every transaction the rule matches. Idempotent via INSERT OR IGNORE
 * against the transaction_tags composite key.
 *
 * A plain `contains` rule with no amount/account/category conditions keeps the
 * fast pure-SQL LIKE path. Any rule with a regex/exact match type, amount
 * bounds, an account scope, or a category assignment drops to JS evaluation:
 * we SELECT the candidate rows (already narrowed by the SQL-expressible
 * conditions — scope, account, amount), test the pattern in JS (SQLite can't
 * run regexes), then write the tag link and optional category.
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
        transactionIds!.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  let created = 0;
  for (const rule of rules) {
    if (isPlainContains(rule)) {
      // Fast path: substring match, no extra conditions — do it all in SQL.
      const like = `%${rule.pattern}%`;
      const res = db.run(sql`
        INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
        SELECT t.id, ${rule.tagId} FROM transactions t
        WHERE (lower(COALESCE(t.merchant_name, '')) LIKE ${like}
            OR lower(t.name) LIKE ${like})
          ${idFilter}`);
      created += (res as { changes: number }).changes;
      continue;
    }

    created += applyAdvancedRule(rule, idFilter);
  }
  return created;
}

/** A rule that can ride the fast SQL LIKE path — no JS evaluation needed. */
function isPlainContains(rule: TagRule): boolean {
  return (
    rule.matchType === "contains" &&
    rule.minAmount == null &&
    rule.maxAmount == null &&
    rule.accountId == null &&
    rule.categoryId == null
  );
}

type CandidateRow = {
  id: string;
  merchant_name: string | null;
  name: string;
};

/**
 * Evaluate an advanced rule (regex/exact match, or with amount/account/category
 * conditions) in JS. The SQL-expressible conditions (id scope, account, amount
 * bounds) narrow the candidate set; the pattern itself is tested in JS.
 */
function applyAdvancedRule(
  rule: TagRule,
  idFilter: ReturnType<typeof sql>,
): number {
  const conditions = [sql`1 = 1`];
  if (rule.accountId != null) conditions.push(sql`t.account_id = ${rule.accountId}`);
  if (rule.minAmount != null) conditions.push(sql`t.amount >= ${rule.minAmount}`);
  if (rule.maxAmount != null) conditions.push(sql`t.amount <= ${rule.maxAmount}`);

  const candidates = db.all<CandidateRow>(sql`
    SELECT t.id AS id, t.merchant_name AS merchant_name, t.name AS name
    FROM transactions t
    WHERE ${sql.join(conditions, sql` AND `)}
      ${idFilter}`);

  const test = buildMatcher(rule);
  if (!test) return 0;

  let created = 0;
  for (const row of candidates) {
    if (!test(row.merchant_name, row.name)) continue;

    const res = db.run(sql`
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
      VALUES (${row.id}, ${rule.tagId})`);
    created += (res as { changes: number }).changes;

    // Assign the rule's category only to still-uncategorised rows, so a manual
    // user categorisation is never clobbered and re-runs stay idempotent.
    if (rule.categoryId != null) {
      db.run(sql`
        UPDATE transactions SET user_category_id = ${rule.categoryId}
        WHERE id = ${row.id} AND user_category_id IS NULL`);
    }
  }
  return created;
}

/**
 * Build a predicate testing a transaction's merchant/name against the rule's
 * pattern per its match type. Returns null when a regex rule has an invalid
 * pattern (that rule is then a no-op rather than throwing during sync).
 */
function buildMatcher(
  rule: TagRule,
): ((merchant: string | null, name: string) => boolean) | null {
  if (rule.matchType === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      return null;
    }
    return (merchant, name) =>
      (merchant != null && re.test(merchant)) || re.test(name);
  }

  const needle = rule.pattern.toLowerCase();
  if (rule.matchType === "exact") {
    return (merchant, name) =>
      (merchant ?? "").toLowerCase() === needle || name.toLowerCase() === needle;
  }

  // contains (with amount/account/category conditions)
  return (merchant, name) =>
    (merchant ?? "").toLowerCase().includes(needle) ||
    name.toLowerCase().includes(needle);
}
