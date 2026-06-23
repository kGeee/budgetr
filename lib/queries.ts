import { db } from "@/db";
import { accounts, holdings, items, securities } from "@/db/schema";
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
};

// Group transactions by vendor — merchant name when Plaid provides one, else raw descriptor.
const vendorKeyExpr = sql`COALESCE(NULLIF(t.merchant_name, ''), t.name)`;

/** All vendors, ranked by spend, with transaction count and last-seen date. */
export function getVendors(): VendorRow[] {
  return db
    .all<{
      vendorKey: string;
      merchant: string | null;
      sampleName: string;
      count: number;
      spent: number;
      lastDate: string;
    }>(
      sql`SELECT ${vendorKeyExpr} AS vendorKey,
             MAX(t.merchant_name) AS merchant, MAX(t.name) AS sampleName,
             COUNT(*) AS count,
             SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS spent,
             MAX(t.date) AS lastDate
          FROM transactions t
          WHERE t.pending = 0
          GROUP BY vendorKey
          ORDER BY spent DESC, count DESC`,
    )
    .map((r) => ({
      vendorKey: r.vendorKey,
      displayName: cleanTransactionName(r.sampleName, r.merchant),
      count: Number(r.count),
      spent: Number(r.spent),
      lastDate: r.lastDate,
    }));
}

/** Every transaction for a given vendor key, newest first. */
export function getVendorTransactions(vendorKey: string): TransactionRow[] {
  return selectTransactions(sql`${vendorKeyExpr} = ${vendorKey}`, 500);
}

/** Unreviewed transactions, newest first — the review inbox. */
export function getTransactionsToReview(limit = 100): TransactionRow[] {
  return selectTransactions(sql`t.reviewed = 0 AND t.pending = 0`, limit);
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
  return db
    .select({
      id: holdings.id,
      quantity: holdings.quantity,
      costBasis: holdings.costBasis,
      price: holdings.institutionPrice,
      value: holdings.institutionValue,
      currency: holdings.isoCurrencyCode,
      ticker: securities.tickerSymbol,
      securityName: securities.name,
      securityType: securities.type,
      accountName: accounts.name,
    })
    .from(holdings)
    .leftJoin(securities, eq(holdings.securityId, securities.id))
    .leftJoin(accounts, eq(holdings.accountId, accounts.id))
    .orderBy(desc(holdings.institutionValue))
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
