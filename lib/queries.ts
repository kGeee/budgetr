import { db } from "@/db";
import {
  accounts,
  holdingCostBasisOverrides,
  holdings,
  investmentSectors,
  investmentTransactions,
  items,
  manualHoldings,
  securities,
  vendorGroupMembers,
  vendorGroups,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { cleanTransactionName } from "@/lib/utils";

// Plaid primaries that resolve to a `transfer` category are internal money
// movement, not real income/spending. Source of truth is the categories table
// (seeded with TRANSFER_IN / TRANSFER_OUT / LOAN_PAYMENTS in the transfer group),
// so user re-categorization stays consistent everywhere.
const transferPrimaries = sql`
  SELECT plaid_primary FROM categories
  WHERE "group" = 'transfer' AND plaid_primary IS NOT NULL`;

/**
 * SQL resolving a transaction (under table alias `alias`) to its effective
 * category id: the user's override if set, else the category mapped to its
 * Plaid primary. Alias-parameterized so it composes inside aliased joins/subqueries.
 */
function effectiveCatId(alias: string) {
  const a = sql.raw(alias);
  return sql`COALESCE(
    ${a}.user_category_id,
    (SELECT c.id FROM categories c WHERE c.plaid_primary = ${a}.category)
  )`;
}

export type NetWorth = { assets: number; liabilities: number; net: number };

export function getNetWorth(): NetWorth {
  const rows = db
    .select({ type: accounts.type, total: sql<number>`COALESCE(SUM(${accounts.currentBalance}), 0)` })
    .from(accounts)
    .groupBy(accounts.type)
    .all();

  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (r.type === "credit" || r.type === "loan") liabilities += r.total ?? 0;
    else assets += r.total ?? 0;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export function getNetWorthSeries(): { date: string; netWorth: number }[] {
  return db
    .all<{ date: string; netWorth: number }>(
      sql`SELECT date, SUM(balance) AS netWorth
          FROM balance_snapshots
          GROUP BY date
          ORDER BY date ASC`,
    )
    .map((r) => ({ date: r.date, netWorth: Number(r.netWorth) }));
}

export function getMonthlyCashflow(months = 6): {
  month: string;
  income: number;
  expenses: number;
}[] {
  const rows = db.all<{ month: string; income: number; expenses: number }>(
    sql`SELECT substr(date,1,7) AS month,
          SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS income,
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS expenses
        FROM transactions
        WHERE pending = 0
          AND (category IS NULL OR category NOT IN (${transferPrimaries}))
        GROUP BY month
        ORDER BY month DESC
        LIMIT ${months}`,
  );
  return rows
    .map((r) => ({ month: r.month, income: Number(r.income), expenses: Number(r.expenses) }))
    .reverse();
}

export type CategorySpend = {
  categoryId: string | null;
  category: string;
  icon: string | null;
  total: number;
};

export function getSpendingByCategory(days = 30): CategorySpend[] {
  return db
    .all<{ categoryId: string | null; name: string | null; icon: string | null; total: number }>(
      sql`SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon, SUM(t.amount) AS total
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND t.date >= date('now', ${"-" + days + " days"})
          GROUP BY cat.id
          ORDER BY total DESC`,
    )
    .map((r) => ({
      categoryId: r.categoryId,
      category: r.name ?? "Uncategorized",
      icon: r.icon,
      total: Number(r.total),
    }));
}

export type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  group: string;
  sortOrder: number;
  spend30: number;
};

/** All non-archived categories, ordered by group then sort order, with 30-day spend. */
export function getCategories(): CategoryRow[] {
  return db
    .all<CategoryRow>(
      sql`SELECT cat.id AS id, cat.name AS name, cat.icon AS icon, cat.color AS color,
             cat."group" AS "group", cat.sort_order AS sortOrder,
             COALESCE((
               SELECT SUM(t.amount) FROM transactions t
               WHERE t.pending = 0 AND t.amount > 0
                 AND ${effectiveCatId("t")} = cat.id
                 AND t.date >= date('now', '-30 days')
             ), 0) AS spend30
          FROM categories cat
          WHERE cat.archived = 0
          ORDER BY
            CASE cat."group" WHEN 'income' THEN 0 WHEN 'spending' THEN 1 ELSE 2 END,
            cat.sort_order ASC, cat.name ASC`,
    )
    .map((r) => ({ ...r, spend30: Number(r.spend30) }));
}

export type BudgetRow = {
  categoryId: string;
  name: string;
  icon: string | null;
  budget: number | null;
  spent: number;
  remaining: number | null;
};

/**
 * The month budgets are evaluated against: the current calendar month if it has
 * any transactions, otherwise the most recent month that does. Keeps budgets
 * live in normal use while still reflecting spend on historical/sandbox data.
 * Returns 'YYYY-MM'.
 */
export function getBudgetMonth(): string {
  const row = db.get<{ m: string | null }>(sql`
    SELECT CASE
      WHEN EXISTS(
        SELECT 1 FROM transactions
        WHERE pending = 0 AND substr(date, 1, 7) = strftime('%Y-%m', 'now')
      ) THEN strftime('%Y-%m', 'now')
      ELSE (SELECT MAX(substr(date, 1, 7)) FROM transactions WHERE pending = 0)
    END AS m`);
  return row?.m ?? new Date().toISOString().slice(0, 7);
}

/** Every spending category with its monthly budget (if any) and the budget month's spend. */
export function getBudgetsWithSpend(): BudgetRow[] {
  const month = getBudgetMonth();
  return db
    .all<{
      categoryId: string;
      name: string;
      icon: string | null;
      budget: number | null;
      spent: number;
    }>(
      sql`SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon,
             b.amount AS budget,
             COALESCE((
               SELECT SUM(t.amount) FROM transactions t
               WHERE t.pending = 0 AND t.amount > 0
                 AND ${effectiveCatId("t")} = cat.id
                 AND substr(t.date, 1, 7) = ${month}
             ), 0) AS spent
          FROM categories cat
          LEFT JOIN budgets b ON b.category_id = cat.id
          WHERE cat.archived = 0 AND cat."group" = 'spending'
          ORDER BY (b.amount IS NULL), spent DESC, cat.sort_order ASC`,
    )
    .map((r) => {
      const budget = r.budget == null ? null : Number(r.budget);
      const spent = Number(r.spent);
      return {
        categoryId: r.categoryId,
        name: r.name,
        icon: r.icon,
        budget,
        spent,
        remaining: budget == null ? null : budget - spent,
      };
    });
}

/**
 * Every tag with its monthly budget (if any) and this month's spend across
 * tagged transactions. Reuses BudgetRow (categoryId field carries the tag id).
 */
export function getTagBudgetsWithSpend(): BudgetRow[] {
  const month = getBudgetMonth();
  return db
    .all<{ categoryId: string; name: string; budget: number | null; spent: number }>(
      sql`SELECT tg.id AS categoryId, ('#' || tg.name) AS name,
             b.amount AS budget,
             COALESCE((
               SELECT SUM(t.amount) FROM transactions t
               JOIN transaction_tags tt ON tt.transaction_id = t.id
               WHERE tt.tag_id = tg.id AND t.pending = 0 AND t.amount > 0
                 AND substr(t.date, 1, 7) = ${month}
             ), 0) AS spent
          FROM tags tg
          LEFT JOIN tag_budgets b ON b.tag_id = tg.id
          ORDER BY (b.amount IS NULL), spent DESC, tg.name ASC`,
    )
    .map((r) => {
      const budget = r.budget == null ? null : Number(r.budget);
      const spent = Number(r.spent);
      return {
        categoryId: r.categoryId,
        name: r.name,
        icon: null,
        budget,
        spent,
        remaining: budget == null ? null : budget - spent,
      };
    });
}

export type BudgetSummary = {
  totalBudget: number;
  totalSpent: number;
  left: number;
  month: string;
};

/** Budget-month totals across all budgeted spending categories. */
export function getMonthlyBudgetSummary(): BudgetSummary {
  const month = getBudgetMonth();
  const totalBudget = Number(
    db.get<{ v: number }>(
      sql`SELECT COALESCE(SUM(b.amount), 0) AS v
          FROM budgets b
          JOIN categories cat ON cat.id = b.category_id
          WHERE cat.archived = 0 AND cat."group" = 'spending'`,
    )?.v ?? 0,
  );
  const totalSpent = Number(
    db.get<{ v: number }>(
      sql`SELECT COALESCE(SUM(t.amount), 0) AS v
          FROM transactions t
          JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          JOIN budgets b ON b.category_id = cat.id
          WHERE t.pending = 0 AND t.amount > 0
            AND cat."group" = 'spending'
            AND substr(t.date, 1, 7) = ${month}`,
    )?.v ?? 0,
  );
  return { totalBudget, totalSpent, left: totalBudget - totalSpent, month };
}

export type CategoryTrend = {
  category: string;
  icon: string | null;
  thisMonth: number;
  prevMonth: number;
};

/**
 * Per spending-category spend for the budget month and the month before it —
 * the raw material for "this category is climbing" insights. Categories with no
 * spend in either month are excluded.
 */
export function getCategorySpendTrend(): CategoryTrend[] {
  const month = getBudgetMonth();
  const prevExpr = sql`strftime('%Y-%m', ${month + "-01"}, '-1 month')`;
  return db
    .all<{ category: string; icon: string | null; thisMonth: number; prevMonth: number }>(
      sql`SELECT cat.name AS category, cat.icon AS icon,
             COALESCE(SUM(CASE WHEN substr(t.date,1,7) = ${month} THEN t.amount ELSE 0 END), 0) AS thisMonth,
             COALESCE(SUM(CASE WHEN substr(t.date,1,7) = ${prevExpr} THEN t.amount ELSE 0 END), 0) AS prevMonth
          FROM transactions t
          JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0 AND cat."group" = 'spending'
            AND substr(t.date,1,7) IN (${month}, ${prevExpr})
          GROUP BY cat.id
          ORDER BY thisMonth DESC`,
    )
    .map((r) => ({
      category: r.category,
      icon: r.icon,
      thisMonth: Number(r.thisMonth),
      prevMonth: Number(r.prevMonth),
    }));
}

export type TopMerchant = { vendor: string; total: number; count: number };

/** Highest-spend merchants over the last `days`, excluding internal transfers. */
export function getTopMerchants(days = 90, limit = 8): TopMerchant[] {
  return db
    .all<{ vendor: string | null; total: number; count: number }>(
      sql`SELECT COALESCE(t.merchant_name, t.name) AS vendor,
             SUM(t.amount) AS total, COUNT(*) AS count
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND t.date >= date('now', ${"-" + days + " days"})
          GROUP BY vendor
          ORDER BY total DESC
          LIMIT ${limit}`,
    )
    .map((r) => ({
      vendor: cleanTransactionName(r.vendor ?? "Unknown", null),
      total: Number(r.total),
      count: Number(r.count),
    }));
}

export type TxTag = { id: string; name: string; color: string | null };

export type TransactionRow = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  displayName: string;
  amount: number;
  currency: string | null;
  accountName: string | null;
  pending: boolean;
  plaidCategory: string | null;
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  reviewed: boolean;
  notes: string | null;
  recurring: boolean;
  tags: TxTag[];
};

/** Shared transaction selector — resolves effective category + aggregates tags as JSON. */
function selectTransactions(where: ReturnType<typeof sql> | null, limit: number): TransactionRow[] {
  const filter = where ? sql`WHERE ${where}` : sql``;
  const rows = db.all<{
    id: string;
    date: string;
    name: string;
    merchantName: string | null;
    amount: number;
    currency: string | null;
    accountName: string | null;
    pending: number;
    plaidCategory: string | null;
    categoryId: string | null;
    categoryName: string | null;
    categoryIcon: string | null;
    reviewed: number;
    notes: string | null;
    recurring: number;
    tagsJson: string | null;
  }>(sql`
    SELECT t.id AS id, t.date AS date, t.name AS name, t.merchant_name AS merchantName,
           t.amount AS amount, t.iso_currency_code AS currency, a.name AS accountName,
           t.pending AS pending, t.category AS plaidCategory,
           cat.id AS categoryId, cat.name AS categoryName, cat.icon AS categoryIcon,
           t.reviewed AS reviewed, t.notes AS notes,
           EXISTS(SELECT 1 FROM recurring_streams r
                  WHERE r.is_active = 1 AND r.merchant_name IS NOT NULL
                    AND r.merchant_name = t.merchant_name) AS recurring,
           (SELECT json_group_array(json_object('id', tg.id, 'name', tg.name, 'color', tg.color))
            FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
            WHERE tt.transaction_id = t.id) AS tagsJson
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
    ${filter}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ${limit}`);

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    name: r.name,
    merchantName: r.merchantName,
    displayName: cleanTransactionName(r.name, r.merchantName),
    amount: Number(r.amount),
    currency: r.currency,
    accountName: r.accountName,
    pending: !!r.pending,
    plaidCategory: r.plaidCategory,
    categoryId: r.categoryId,
    categoryName: r.categoryName ?? "Uncategorized",
    categoryIcon: r.categoryIcon,
    reviewed: !!r.reviewed,
    notes: r.notes,
    recurring: !!r.recurring,
    tags: r.tagsJson ? (JSON.parse(r.tagsJson) as TxTag[]) : [],
  }));
}

export function getRecentTransactions(limit = 50): TransactionRow[] {
  return selectTransactions(null, limit);
}

export type VendorRow = {
  vendorKey: string;
  displayName: string;
  count: number;
  spent: number;
  lastDate: string;
  groupId: string | null;
  groupName: string | null;
  /** Raw vendor keys merged into this group (only set when vendorKey IS a groupId) */
  members: string[];
};

// Raw vendor key per transaction — merchant name when Plaid provides one, else raw descriptor.
const vendorKeyExpr = sql`COALESCE(NULLIF(t.merchant_name, ''), t.name)`;

/**
 * All vendors, ranked by spend.
 * - Ungrouped vendors appear as individual rows keyed by their raw vendor key.
 * - Grouped vendors are collapsed into a single row keyed by their group id.
 */
export function getVendors(): VendorRow[] {
  // Fetch raw aggregates with group info in one pass.
  const rows = db.all<{
    vendorKey: string;
    merchant: string | null;
    sampleName: string;
    count: number;
    spent: number;
    lastDate: string;
    groupId: string | null;
    groupName: string | null;
  }>(
    sql`SELECT ${vendorKeyExpr} AS vendorKey,
           MAX(t.merchant_name) AS merchant, MAX(t.name) AS sampleName,
           COUNT(*) AS count,
           SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS spent,
           MAX(t.date) AS lastDate,
           vgm.group_id AS groupId,
           vg.name AS groupName
        FROM transactions t
        LEFT JOIN vendor_group_members vgm ON vgm.vendor_key = ${vendorKeyExpr}
        LEFT JOIN vendor_groups vg ON vg.id = vgm.group_id
        WHERE t.pending = 0
        GROUP BY vendorKey
        ORDER BY spent DESC, count DESC`,
  );

  // Merge grouped vendors into single rows.
  const grouped = new Map<string, VendorRow>();
  const ungrouped: VendorRow[] = [];

  for (const r of rows) {
    if (r.groupId) {
      const existing = grouped.get(r.groupId);
      if (existing) {
        existing.count += Number(r.count);
        existing.spent += Number(r.spent);
        if (r.lastDate > existing.lastDate) existing.lastDate = r.lastDate;
        existing.members.push(r.vendorKey);
      } else {
        grouped.set(r.groupId, {
          vendorKey: r.groupId,
          displayName: r.groupName!,
          count: Number(r.count),
          spent: Number(r.spent),
          lastDate: r.lastDate,
          groupId: r.groupId,
          groupName: r.groupName,
          members: [r.vendorKey],
        });
      }
    } else {
      ungrouped.push({
        vendorKey: r.vendorKey,
        displayName: cleanTransactionName(r.sampleName, r.merchant),
        count: Number(r.count),
        spent: Number(r.spent),
        lastDate: r.lastDate,
        groupId: null,
        groupName: null,
        members: [],
      });
    }
  }

  return [...grouped.values(), ...ungrouped].sort((a, b) => b.spent - a.spent);
}

/**
 * SQL matching every transaction for a vendor key — or, when the key is a group
 * id, all member vendor keys. Shared by the vendor transaction + chart queries.
 */
function vendorMatch(vendorKey: string): ReturnType<typeof sql> {
  const isGroup = db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM vendor_group_members WHERE group_id = ${vendorKey}`,
  );
  if (isGroup && isGroup.n > 0) {
    return sql`${vendorKeyExpr} IN (SELECT vendor_key FROM vendor_group_members WHERE group_id = ${vendorKey})`;
  }
  return sql`${vendorKeyExpr} = ${vendorKey}`;
}

/** Every transaction for a given vendor key or group id, newest first. */
export function getVendorTransactions(vendorKey: string): TransactionRow[] {
  return selectTransactions(vendorMatch(vendorKey), 500);
}

export type VendorMonth = { month: string; spent: number; count: number };

/** Month-by-month spend for a vendor (or group), oldest first for charting. */
export function getVendorMonthlySpend(vendorKey: string, months = 12): VendorMonth[] {
  const match = vendorMatch(vendorKey);
  return db
    .all<{ month: string; spent: number; count: number }>(sql`
      SELECT substr(t.date, 1, 7) AS month,
             SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS spent,
             COUNT(*) AS count
      FROM transactions t
      WHERE t.pending = 0 AND ${match}
      GROUP BY month
      ORDER BY month DESC
      LIMIT ${months}`)
    .map((r) => ({ month: r.month, spent: Number(r.spent), count: Number(r.count) }))
    .reverse();
}

/** How a vendor's (or group's) spend splits across effective categories. */
export function getVendorCategoryBreakdown(vendorKey: string): CategorySpend[] {
  const match = vendorMatch(vendorKey);
  return db
    .all<{ categoryId: string | null; name: string | null; icon: string | null; total: number }>(sql`
      SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon, SUM(t.amount) AS total
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
      WHERE t.pending = 0 AND t.amount > 0 AND ${match}
      GROUP BY cat.id
      ORDER BY total DESC`)
    .map((r) => ({
      categoryId: r.categoryId,
      category: r.name ?? "Uncategorized",
      icon: r.icon,
      total: Number(r.total),
    }));
}

export type VendorGroupRow = {
  id: string;
  name: string;
  members: string[];
};

export function getVendorGroups(): VendorGroupRow[] {
  const groups = db.select().from(vendorGroups).all();
  const members = db.select().from(vendorGroupMembers).all();
  const memberMap = new Map<string, string[]>();
  for (const m of members) {
    if (!memberMap.has(m.groupId)) memberMap.set(m.groupId, []);
    memberMap.get(m.groupId)!.push(m.vendorKey);
  }
  return groups.map((g) => ({ id: g.id, name: g.name, members: memberMap.get(g.id) ?? [] }));
}

/** Unreviewed transactions, newest first — the review inbox. */
export function getTransactionsToReview(limit = 100): TransactionRow[] {
  return selectTransactions(sql`t.reviewed = 0 AND t.pending = 0`, limit);
}

// ── Category drill-down ───────────────────────────────────────────────────────

/** Archived categories (for the restore UI), grouped then alphabetical. */
export function getArchivedCategories(): CategoryRow[] {
  return db
    .all<CategoryRow>(
      sql`SELECT cat.id AS id, cat.name AS name, cat.icon AS icon, cat.color AS color,
             cat."group" AS "group", cat.sort_order AS sortOrder, 0 AS spend30
          FROM categories cat
          WHERE cat.archived = 1
          ORDER BY
            CASE cat."group" WHEN 'income' THEN 0 WHEN 'spending' THEN 1 ELSE 2 END,
            cat.sort_order ASC, cat.name ASC`,
    )
    .map((r) => ({ ...r, spend30: Number(r.spend30) }));
}

export type CategoryDetail = {
  id: string;
  name: string;
  icon: string | null;
  group: string;
  archived: boolean;
  /** All-time spend (outflow) in this category. */
  spent: number;
  /** All-time inflow (income/refunds) in this category. */
  received: number;
  count: number;
};

/** Category meta + all-time totals, or null if the id doesn't exist. */
export function getCategoryById(id: string): CategoryDetail | null {
  const r = db.get<{
    id: string;
    name: string;
    icon: string | null;
    group: string;
    archived: number;
    spent: number;
    received: number;
    count: number;
  }>(sql`
    SELECT cat.id AS id, cat.name AS name, cat.icon AS icon, cat."group" AS "group",
           cat.archived AS archived,
           COALESCE((SELECT SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END)
                     FROM transactions t
                     WHERE t.pending = 0 AND ${effectiveCatId("t")} = cat.id), 0) AS spent,
           COALESCE((SELECT SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END)
                     FROM transactions t
                     WHERE t.pending = 0 AND ${effectiveCatId("t")} = cat.id), 0) AS received,
           COALESCE((SELECT COUNT(*) FROM transactions t
                     WHERE t.pending = 0 AND ${effectiveCatId("t")} = cat.id), 0) AS count
    FROM categories cat
    WHERE cat.id = ${id}`);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    group: r.group,
    archived: !!r.archived,
    spent: Number(r.spent),
    received: Number(r.received),
    count: Number(r.count),
  };
}

/** Every (non-pending) transaction that rolls up to this category, newest first. */
export function getCategoryTransactions(id: string, limit = 500): TransactionRow[] {
  return selectTransactions(sql`t.pending = 0 AND ${effectiveCatId("t")} = ${id}`, limit);
}

export type CategoryMonth = { month: string; spent: number; received: number; count: number };

/** Month-by-month breakdown of a category's spend, newest first. */
export function getCategoryMonthlyBreakdown(id: string, months = 12): CategoryMonth[] {
  return db
    .all<{ month: string; spent: number; received: number; count: number }>(sql`
      SELECT substr(t.date, 1, 7) AS month,
             SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS spent,
             SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS received,
             COUNT(*) AS count
      FROM transactions t
      WHERE t.pending = 0 AND ${effectiveCatId("t")} = ${id}
      GROUP BY month
      ORDER BY month DESC
      LIMIT ${months}`)
    .map((r) => ({
      month: r.month,
      spent: Number(r.spent),
      received: Number(r.received),
      count: Number(r.count),
    }));
}

export function getTags(): TxTag[] {
  return db.all<TxTag>(sql`SELECT id, name, color FROM tags ORDER BY name ASC`);
}

export type TagRuleRow = {
  id: string;
  pattern: string;
  label: string | null;
  tagName: string;
  matches: number;
};

/** Auto-tag rules with the count of transactions each currently matches. */
export function getTagRules(): TagRuleRow[] {
  return db.all<TagRuleRow>(sql`
    SELECT r.id AS id, r.pattern AS pattern, r.label AS label, tg.name AS tagName,
      (SELECT COUNT(*) FROM transactions t
        WHERE lower(COALESCE(t.merchant_name,'')) LIKE '%' || r.pattern || '%'
           OR lower(t.name) LIKE '%' || r.pattern || '%') AS matches
    FROM tag_rules r
    JOIN tags tg ON tg.id = r.tag_id
    ORDER BY r.created_at DESC`);
}

export type RecurringRow = {
  id: string;
  direction: "inflow" | "outflow";
  description: string | null;
  merchantName: string | null;
  category: string | null;
  frequency: string | null;
  averageAmount: number | null;
  lastAmount: number | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  currency: string | null;
  accountName: string | null;
  status: string | null;
};

const recurringSelect = sql`
  SELECT r.id AS id, r.direction AS direction, r.description AS description,
         r.merchant_name AS merchantName, r.category AS category, r.frequency AS frequency,
         r.average_amount AS averageAmount, r.last_amount AS lastAmount,
         r.last_date AS lastDate, r.predicted_next_date AS predictedNextDate,
         r.iso_currency_code AS currency, a.name AS accountName, r.status AS status
  FROM recurring_streams r
  LEFT JOIN accounts a ON a.id = r.account_id`;

/** All active recurring streams, soonest predicted payment first. */
export function getRecurringStreams(): RecurringRow[] {
  return db.all<RecurringRow>(sql`
    ${recurringSelect}
    WHERE r.is_active = 1
    ORDER BY (r.predicted_next_date IS NULL), r.predicted_next_date ASC, r.average_amount DESC`);
}

/** Predicted outflow charges within the next `days` days, soonest first. */
export function getUpcomingBills(days = 14): RecurringRow[] {
  return db.all<RecurringRow>(sql`
    ${recurringSelect}
    WHERE r.is_active = 1
      AND r.direction = 'outflow'
      AND r.predicted_next_date IS NOT NULL
      AND r.predicted_next_date >= date('now')
      AND r.predicted_next_date <= date('now', ${"+" + days + " days"})
    ORDER BY r.predicted_next_date ASC`);
}

export function getAccounts() {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      officialName: accounts.officialName,
      mask: accounts.mask,
      type: accounts.type,
      subtype: accounts.subtype,
      currentBalance: accounts.currentBalance,
      availableBalance: accounts.availableBalance,
      currency: accounts.isoCurrencyCode,
      institutionName: items.institutionName,
      itemStatus: items.status,
    })
    .from(accounts)
    .leftJoin(items, eq(accounts.itemId, items.id))
    .all();
}

export function getItems() {
  return db.select().from(items).all();
}

export function getHoldings() {
  const rows = db
    .select({
      id: holdings.id,
      quantity: holdings.quantity,
      plaidCostBasis: holdings.costBasis,
      price: holdings.institutionPrice,
      value: holdings.institutionValue,
      currency: holdings.isoCurrencyCode,
      closePrice: securities.closePrice,
      ticker: securities.tickerSymbol,
      securityName: securities.name,
      securityType: securities.type,
      accountName: accounts.name,
      overrideTotal: holdingCostBasisOverrides.totalCost,
      overrideUnit: holdingCostBasisOverrides.unitCost,
      overrideAsOf: holdingCostBasisOverrides.asOfDate,
    })
    .from(holdings)
    .leftJoin(securities, eq(holdings.securityId, securities.id))
    .leftJoin(accounts, eq(holdings.accountId, accounts.id))
    .leftJoin(
      holdingCostBasisOverrides,
      eq(holdingCostBasisOverrides.holdingId, holdings.id),
    )
    .orderBy(desc(holdings.institutionValue))
    .all();

  // Resolve the effective cost basis: a per-share override (preferred — stays
  // correct as quantity changes) wins, else a total-dollar override, else
  // Plaid's reported basis. `costBasis` carries the resolved figure so all
  // downstream P&L math is automatically correction-aware.
  return rows.map((r) => {
    const hasOverride = r.overrideTotal != null || r.overrideUnit != null;
    const costBasis =
      r.overrideUnit != null && r.quantity != null
        ? r.overrideUnit * r.quantity
        : r.overrideTotal != null
          ? r.overrideTotal
          : r.plaidCostBasis;
    return {
      id: r.id,
      quantity: r.quantity,
      costBasis,
      price: r.price,
      value: r.value,
      currency: r.currency,
      closePrice: r.closePrice,
      ticker: r.ticker,
      securityName: r.securityName,
      securityType: r.securityType,
      accountName: r.accountName,
      plaidCostBasis: r.plaidCostBasis,
      overrideTotal: r.overrideTotal,
      overrideUnit: r.overrideUnit,
      overrideAsOf: r.overrideAsOf,
      hasOverride,
    };
  });
}

/**
 * Sector key for a holding — uppercased ticker (`sym:AAPL`) so every position of
 * a ticker shares one sector, else the manual-holding id (`man:<id>`) for
 * symbol-less fixed-value assets. Mirror in actions.ts / portfolio-view.tsx.
 */
export function sectorKeyFor(ticker: string | null | undefined, id: string): string {
  return ticker ? `sym:${ticker.toUpperCase()}` : `man:${id}`;
}

/** Map of sectorKey → sector name for every assigned investment. */
export function getInvestmentSectors(): Record<string, string> {
  const rows = db
    .select({ sectorKey: investmentSectors.sectorKey, sector: investmentSectors.sector })
    .from(investmentSectors)
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.sectorKey] = r.sector;
  return map;
}

/** Distinct sector names already in use, alphabetical — backs the editor's suggestions. */
export function getKnownSectors(): string[] {
  return db
    .selectDistinct({ sector: investmentSectors.sector })
    .from(investmentSectors)
    .orderBy(investmentSectors.sector)
    .all()
    .map((r) => r.sector);
}

export type ManualHoldingRow = {
  id: string;
  symbol: string | null;
  name: string;
  type: string | null;
  quantity: number | null;
  costBasis: number | null;
  manualValue: number | null;
  currency: string | null;
};

/** User-entered off-Plaid holdings (crypto, fixed-value assets), newest first. */
export function getManualHoldings(): ManualHoldingRow[] {
  return db
    .select({
      id: manualHoldings.id,
      symbol: manualHoldings.symbol,
      name: manualHoldings.name,
      type: manualHoldings.type,
      quantity: manualHoldings.quantity,
      costBasis: manualHoldings.costBasis,
      manualValue: manualHoldings.manualValue,
      currency: manualHoldings.isoCurrencyCode,
    })
    .from(manualHoldings)
    .orderBy(desc(manualHoldings.createdAt))
    .all();
}

export type InvestmentTxnRow = {
  id: string;
  date: string;
  name: string;
  type: string | null;
  subtype: string | null;
  quantity: number | null;
  amount: number | null;
  price: number | null;
  fees: number | null;
  currency: string | null;
  ticker: string | null;
  securityName: string | null;
  accountName: string | null;
};

/** All investment transactions (buys/sells/dividends), newest first, with ticker. */
export function getInvestmentTransactions(): InvestmentTxnRow[] {
  return db
    .select({
      id: investmentTransactions.id,
      date: investmentTransactions.date,
      name: investmentTransactions.name,
      type: investmentTransactions.type,
      subtype: investmentTransactions.subtype,
      quantity: investmentTransactions.quantity,
      amount: investmentTransactions.amount,
      price: investmentTransactions.price,
      fees: investmentTransactions.fees,
      currency: investmentTransactions.isoCurrencyCode,
      ticker: securities.tickerSymbol,
      securityName: securities.name,
      accountName: accounts.name,
    })
    .from(investmentTransactions)
    .leftJoin(securities, eq(investmentTransactions.securityId, securities.id))
    .leftJoin(accounts, eq(investmentTransactions.accountId, accounts.id))
    .orderBy(desc(investmentTransactions.date))
    .all();
}

export function prettyCategory(c: string | null): string {
  if (!c) return "Uncategorized";
  return c
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
