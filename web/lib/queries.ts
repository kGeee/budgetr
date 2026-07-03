import { db } from "@/db";
import {
  accounts,
  allocationTargets,
  appSettings,
  costBasisMethod,
  dashboardWidgets,
  dashboards,
  exchangeRates,
  holdingCostBasisOverrides,
  holdings,
  investmentAssetClasses,
  investmentGeographies,
  investmentSectors,
  investmentTransactions,
  items,
  manualHoldings,
  savedFilters,
  savingsContributions,
  securities,
  taxLotOverrides,
  vendorGroupMembers,
  vendorGroups,
  type SavedFilter,
} from "@/db/schema";
import type { SavingsContribution, Dashboard, DashboardWidget } from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { cleanTransactionName } from "@/lib/utils";
import {
  computeRealizedLots,
  summarize,
  summarizeByYear,
  type LotOverride,
  type RealizedLot,
  type YearSummary,
} from "@/lib/tax-lots";
import {
  buildDividendSummary,
  isDividendTxn,
  type DividendSummary,
} from "@/lib/dividends";

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
export function effectiveCatId(alias: string) {
  const a = sql.raw(alias);
  return sql`COALESCE(
    ${a}.user_category_id,
    (SELECT c.id FROM categories c WHERE c.plaid_primary = ${a}.category)
  )`;
}

/**
 * SQL predicate: the transaction under alias `alias` is a leg of a *confirmed*
 * refund/transfer match. Such transactions are internal money movement (a
 * transfer to yourself) or a reversal (a refund), so excluding both legs keeps
 * cashflow and category spend from double-counting. Alias-parameterized to
 * compose inside aliased joins/subqueries.
 */
function isConfirmedMatch(alias: string) {
  const a = sql.raw(alias);
  return sql`EXISTS (
    SELECT 1 FROM transaction_matches m
    WHERE m.status = 'confirmed' AND (m.txn_a_id = ${a}.id OR m.txn_b_id = ${a}.id)
  )`;
}

/**
 * A CTE named `spend_rows` that flattens every transaction into one or more
 * category-attributed rows, so category/budget reporting stays correct when a
 * transaction is split (see the transaction_splits overlay):
 *  - Unsplit transactions contribute a single row carrying the full amount at
 *    their effective category (effectiveCatId).
 *  - Split transactions contribute one row per split — the split's amount at the
 *    split's category — and never the parent amount, so nothing double-counts.
 *
 * Each row exposes (txn_id, date, pending, amount, category_id) with the same
 * sign convention as transactions.amount. Splice into a query with
 * `sql`WITH ${spendRowsCte} SELECT ... FROM spend_rows sr ...``.
 */
const spendRowsCte = sql`spend_rows AS (
  SELECT t.id AS txn_id, t.date AS date, t.pending AS pending, t.amount AS amount,
         ${effectiveCatId("t")} AS category_id
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
    AND NOT ${isConfirmedMatch("t")}
  UNION ALL
  SELECT t.id AS txn_id, t.date AS date, t.pending AS pending, s.amount AS amount,
         s.category_id AS category_id
  FROM transactions t
  JOIN transaction_splits s ON s.transaction_id = t.id
  WHERE NOT ${isConfirmedMatch("t")}
)`;

/**
 * SQL matching transactions (alias `t`) that roll up to category `id`: either an
 * unsplit transaction whose effective category is `id`, or a split transaction
 * with at least one split in `id`. The full transaction is returned, so a split
 * transaction can legitimately appear under more than one category.
 */
function txnInCategory(id: string): ReturnType<typeof sql> {
  return sql`(
    (NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
      AND ${effectiveCatId("t")} = ${id})
    OR EXISTS (SELECT 1 FROM transaction_splits s
               WHERE s.transaction_id = t.id AND s.category_id = ${id})
  )`;
}

export type TransactionSplitRow = {
  id: string;
  transactionId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  amount: number;
  note: string | null;
};

/** The splits overlaying one transaction, joined to their category name/icon. */
export function getTransactionSplits(txnId: string): TransactionSplitRow[] {
  return db
    .all<{
      id: string;
      transactionId: string;
      categoryId: string | null;
      categoryName: string | null;
      categoryIcon: string | null;
      amount: number;
      note: string | null;
    }>(sql`
      SELECT s.id AS id, s.transaction_id AS transactionId, s.category_id AS categoryId,
             cat.name AS categoryName, cat.icon AS categoryIcon,
             s.amount AS amount, s.note AS note
      FROM transaction_splits s
      LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE s.transaction_id = ${txnId}
      ORDER BY s.rowid ASC`)
    .map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryIcon: r.categoryIcon,
      amount: Number(r.amount),
      note: r.note,
    }));
}

export type AttachmentRow = {
  id: string;
  transactionId: string;
  mimeType: string | null;
  size: number | null;
  originalName: string | null;
  createdAt: number; // epoch ms
  /** True when the file is a raster/vector image (drives inline thumbnails). */
  isImage: boolean;
};

/** Metadata for the files attached to one transaction (newest first). */
export function getAttachments(txnId: string): AttachmentRow[] {
  return db
    .all<{
      id: string;
      transactionId: string;
      mimeType: string | null;
      size: number | null;
      originalName: string | null;
      createdAt: number;
    }>(sql`
      SELECT id, transaction_id AS transactionId, mime_type AS mimeType,
             size, original_name AS originalName, created_at AS createdAt
      FROM attachments
      WHERE transaction_id = ${txnId}
      ORDER BY created_at DESC, id DESC`)
    .map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      mimeType: r.mimeType,
      size: r.size,
      originalName: r.originalName,
      createdAt: Number(r.createdAt) * 1000, // stored as unix seconds (timestamp mode)
      isImage: !!r.mimeType && r.mimeType.startsWith("image/"),
    }));
}

export type NetWorth = { assets: number; liabilities: number; net: number };

export function getNetWorth(): NetWorth {
  const rows = db
    .select({ type: accounts.type, total: sql<number>`COALESCE(SUM(${accounts.currentBalance}), 0)` })
    .from(accounts)
    .where(eq(accounts.excluded, false))
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
        FROM transactions t
        WHERE pending = 0
          AND (category IS NULL OR category NOT IN (${transferPrimaries}))
          AND NOT ${isConfirmedMatch("t")}
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
      sql`WITH ${spendRowsCte}
          SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon, SUM(sr.amount) AS total
          FROM spend_rows sr
          LEFT JOIN categories cat ON cat.id = sr.category_id
          WHERE sr.pending = 0 AND sr.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND sr.date >= date('now', ${"-" + days + " days"})
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
      sql`WITH ${spendRowsCte}
          SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon,
             b.amount AS budget,
             COALESCE((
               SELECT SUM(sr.amount) FROM spend_rows sr
               WHERE sr.pending = 0 AND sr.amount > 0
                 AND sr.category_id = cat.id
                 AND substr(sr.date, 1, 7) = ${month}
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

/** A BudgetRow plus its envelope/rollover state for the budget month. */
export type EnvelopeBudgetRow = BudgetRow & {
  rollover: boolean;
  carryIn: number; // balance carried into this month (+ unused, − overspent)
  available: number; // budget + carryIn − spent — what's actually spendable
  carryOut: number; // projected balance rolling into next month (= available)
};

/**
 * Envelope view of every spending category: the plain budget/spend of
 * getBudgetsWithSpend plus the rollover toggle and the persisted carry-in for
 * getBudgetMonth(). available = budget + carryIn − spent; carryOut = available
 * (what next month would inherit). Non-rollover categories read carryIn 0, so
 * their available/carryOut collapse to the usual remaining.
 */
export function getEnvelopeBudgets(): EnvelopeBudgetRow[] {
  const month = getBudgetMonth();
  return db
    .all<{
      categoryId: string;
      name: string;
      icon: string | null;
      budget: number | null;
      rollover: number;
      carryIn: number;
      spent: number;
    }>(
      sql`SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon,
             b.amount AS budget,
             COALESCE(b.rollover, 0) AS rollover,
             COALESCE((
               SELECT r.carry_in FROM budget_rollovers r
               WHERE r.category_id = cat.id AND r.month = ${month}
             ), 0) AS carryIn,
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
      const rollover = Boolean(r.rollover);
      const carryIn = rollover ? Number(r.carryIn) : 0;
      // available/carryOut only meaningful once a budget exists; keep them at 0
      // for unbudgeted rows so the UI shows "No budget" as before.
      const available = budget == null ? 0 : budget + carryIn - spent;
      return {
        categoryId: r.categoryId,
        name: r.name,
        icon: r.icon,
        budget,
        spent,
        remaining: budget == null ? null : budget - spent,
        rollover,
        carryIn,
        available,
        carryOut: available,
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

/**
 * Per-day spend for the budget month across budgeted spending categories only —
 * mirrors getMonthlyBudgetSummary.totalSpent so a cumulative chart reconciles
 * with the budget totals. Returns days with spend, oldest first.
 */
export function getBudgetSpendByDay(): { date: string; spent: number }[] {
  const month = getBudgetMonth();
  return db
    .all<{ date: string; spent: number }>(
      sql`SELECT t.date AS date, SUM(t.amount) AS spent
          FROM transactions t
          JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          JOIN budgets b ON b.category_id = cat.id
          WHERE t.pending = 0 AND t.amount > 0
            AND cat."group" = 'spending'
            AND substr(t.date, 1, 7) = ${month}
          GROUP BY t.date
          ORDER BY t.date ASC`,
    )
    .map((r) => ({ date: r.date, spent: Number(r.spent) }));
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
  /** Number of category splits overlaying this transaction (0 = unsplit). */
  splitCount: number;
  /** Number of receipt/invoice files attached (0 = none). Drives the paperclip. */
  attachmentCount: number;
  /** True when this transaction is a leg of a confirmed refund/transfer match. */
  matched: boolean;
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
    splitCount: number;
    attachmentCount: number;
    matched: number;
    tagsJson: string | null;
  }>(sql`
    SELECT t.id AS id, t.date AS date, t.name AS name, t.merchant_name AS merchantName,
           t.amount AS amount, t.iso_currency_code AS currency, a.name AS accountName,
           t.pending AS pending, t.category AS plaidCategory,
           cat.id AS categoryId, cat.name AS categoryName, cat.icon AS categoryIcon,
           t.reviewed AS reviewed, t.notes AS notes,
           (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS splitCount,
           (SELECT COUNT(*) FROM attachments at WHERE at.transaction_id = t.id) AS attachmentCount,
           ${isConfirmedMatch("t")} AS matched,
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
    splitCount: Number(r.splitCount),
    attachmentCount: Number(r.attachmentCount),
    matched: !!r.matched,
    tags: r.tagsJson ? (JSON.parse(r.tagsJson) as TxTag[]) : [],
  }));
}

export function getRecentTransactions(limit = 50): TransactionRow[] {
  return selectTransactions(null, limit);
}

/**
 * Filter criteria for the transactions search bar. Every field is optional; the
 * empty object matches everything. Serialized to JSON in the saved_filters table
 * so recalling a filter is just `JSON.parse` back into this shape.
 */
export type TxnCriteria = {
  /** Free text matched (case-insensitive substring) over name / merchant / notes. */
  q?: string;
  accountId?: string;
  /** Effective (or split) category — see txnInCategory. */
  categoryId?: string;
  tagId?: string;
  dateFrom?: string; // YYYY-MM-DD, inclusive
  dateTo?: string; // YYYY-MM-DD, inclusive
  amountMin?: number; // abs(amount) >=
  amountMax?: number; // abs(amount) <=
};

/**
 * Full-text-ish search over transactions. Composes each supplied criterion into
 * a `WHERE` fragment and hands it to the shared selectTransactions() selector —
 * no selector rewrite. The text clause reuses the LIKE idiom from getTagRules
 * (lower(col) LIKE '%q%'); category membership reuses txnInCategory so split
 * transactions still surface under any of their split categories.
 */
export function searchTransactions(criteria: TxnCriteria, limit = 200): TransactionRow[] {
  const clauses: ReturnType<typeof sql>[] = [];

  const q = criteria.q?.trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    clauses.push(sql`(
      lower(t.name) LIKE ${like}
      OR lower(COALESCE(t.merchant_name, '')) LIKE ${like}
      OR lower(COALESCE(t.notes, '')) LIKE ${like}
    )`);
  }

  if (criteria.accountId) clauses.push(sql`t.account_id = ${criteria.accountId}`);
  if (criteria.categoryId) clauses.push(txnInCategory(criteria.categoryId));
  if (criteria.tagId) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM transaction_tags tt
      WHERE tt.transaction_id = t.id AND tt.tag_id = ${criteria.tagId})`);
  }
  if (criteria.dateFrom) clauses.push(sql`t.date >= ${criteria.dateFrom}`);
  if (criteria.dateTo) clauses.push(sql`t.date <= ${criteria.dateTo}`);
  if (criteria.amountMin != null) clauses.push(sql`abs(t.amount) >= ${criteria.amountMin}`);
  if (criteria.amountMax != null) clauses.push(sql`abs(t.amount) <= ${criteria.amountMax}`);

  const where = clauses.length ? sql.join(clauses, sql` AND `) : null;
  return selectTransactions(where, limit);
}

/** All saved transaction filters, newest first. */
export function getSavedFilters(): SavedFilter[] {
  return db.select().from(savedFilters).orderBy(desc(savedFilters.createdAt)).all();
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

// ── History-based suggestions ───────────────────────────────────────────────────

/**
 * Group-aware vendor match for a *single* transaction id — mirrors the logic in
 * getVendorReclassCount. Resolves the transaction's vendor key, expands it to
 * the whole vendor group when it belongs to one, and returns a `t.`-aliased SQL
 * predicate matching every transaction from that vendor. Returns null when the
 * transaction doesn't exist. The predicate reuses `vendorKeyExpr` (alias `t`),
 * so splice it into a query that aliases the transactions table as `t`.
 */
function vendorMatchForTxn(
  txnId: string,
): { match: ReturnType<typeof sql>; vendorKey: string } | null {
  const tx = db.get<{ vendorKey: string }>(
    sql`SELECT COALESCE(NULLIF(merchant_name, ''), name) AS vendorKey
        FROM transactions WHERE id = ${txnId}`,
  );
  if (!tx) return null;

  const grp = db.get<{ groupId: string }>(
    sql`SELECT group_id AS groupId FROM vendor_group_members WHERE vendor_key = ${tx.vendorKey}`,
  );
  const match = grp
    ? sql`${vendorKeyExpr} IN (SELECT vendor_key FROM vendor_group_members WHERE group_id = ${grp.groupId})`
    : sql`${vendorKeyExpr} = ${tx.vendorKey}`;
  return { match, vendorKey: tx.vendorKey };
}

export type CategorySuggestion = {
  categoryId: string;
  categoryName: string;
  icon: string | null;
  /** How many of this vendor's other transactions the user filed under it. */
  count: number;
  /** Share of this vendor's user-classified history that used it (0–1). */
  confidence: number;
};

/**
 * ML-lite category suggestion: how did the user previously classify this vendor?
 * Counts the *explicit* user category overrides on this vendor's OTHER (group-aware)
 * transactions and returns the most frequent one with its count and confidence
 * (its share of all this vendor's classified history), or null when there's no
 * history to learn from. Pure read-model over the existing overlay — no schema.
 */
export function getCategorySuggestion(txnId: string): CategorySuggestion | null {
  const v = vendorMatchForTxn(txnId);
  if (!v) return null;

  const rows = db.all<{ categoryId: string; categoryName: string; icon: string | null; n: number }>(
    sql`SELECT t.user_category_id AS categoryId, cat.name AS categoryName, cat.icon AS icon,
               COUNT(*) AS n
        FROM transactions t
        JOIN categories cat ON cat.id = t.user_category_id
        WHERE t.id != ${txnId} AND t.pending = 0 AND cat.archived = 0 AND ${v.match}
        GROUP BY t.user_category_id
        ORDER BY n DESC, categoryName ASC`,
  );
  if (rows.length === 0) return null;

  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const top = rows[0];
  const count = Number(top.n);
  return {
    categoryId: top.categoryId,
    categoryName: top.categoryName,
    icon: top.icon,
    count,
    confidence: count / total,
  };
}

export type TagSuggestion = { id: string; name: string; color: string | null; count: number };

/**
 * The tags most frequently applied to this vendor's past (group-aware)
 * transactions, excluding any already on this transaction — the top `limit`,
 * most-used first. Empty when the vendor has no tag history left to suggest.
 */
export function getTagSuggestions(txnId: string, limit = 4): TagSuggestion[] {
  const v = vendorMatchForTxn(txnId);
  if (!v) return [];

  return db
    .all<{ id: string; name: string; color: string | null; count: number }>(
      sql`SELECT tg.id AS id, tg.name AS name, tg.color AS color, COUNT(*) AS count
          FROM transactions t
          JOIN transaction_tags tt ON tt.transaction_id = t.id
          JOIN tags tg ON tg.id = tt.tag_id
          WHERE t.id != ${txnId} AND ${v.match}
            AND tt.tag_id NOT IN
              (SELECT tag_id FROM transaction_tags WHERE transaction_id = ${txnId})
          GROUP BY tg.id
          ORDER BY count DESC, tg.name ASC
          LIMIT ${limit}`,
    )
    .map((r) => ({ id: r.id, name: r.name, color: r.color, count: Number(r.count) }));
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
  return selectTransactions(sql`t.pending = 0 AND ${txnInCategory(id)}`, limit);
}

export function getTransactionsByDate(date: string): TransactionRow[] {
  return selectTransactions(sql`t.pending = 0 AND t.date = ${date}`, 500);
}

export type CategoryDay = { date: string; spent: number; received: number };

/** Day-by-day total spending across all spending categories, last N days, oldest first. */
export function getDailySpend(days = 30): { date: string; spent: number }[] {
  return db
    .all<{ date: string; spent: number }>(sql`
      SELECT t.date AS date,
             SUM(t.amount) AS spent
      FROM transactions t
      JOIN categories cat ON cat.id = ${effectiveCatId("t")}
      WHERE t.pending = 0
        AND t.amount > 0
        AND cat."group" = 'spending'
        AND t.date >= date('now', ${`-${days} days`})
      GROUP BY t.date
      ORDER BY t.date ASC`)
    .map((r) => ({ date: r.date, spent: Number(r.spent) }));
}

/**
 * Day-by-day total spending across all spending categories between two ISO
 * dates (inclusive), oldest first. Same spending-only / transfer-excluded WHERE
 * as {@link getDailySpend}, but over an explicit window (e.g. a trailing year
 * for the contribution-graph heatmap). Days with no spend are simply absent.
 */
export function getDailySpendRange(
  start: string,
  end: string,
): { date: string; spent: number }[] {
  return db
    .all<{ date: string; spent: number }>(sql`
      SELECT t.date AS date,
             SUM(t.amount) AS spent
      FROM transactions t
      JOIN categories cat ON cat.id = ${effectiveCatId("t")}
      WHERE t.pending = 0
        AND t.amount > 0
        AND cat."group" = 'spending'
        AND t.date >= ${start}
        AND t.date <= ${end}
      GROUP BY t.date
      ORDER BY t.date ASC`)
    .map((r) => ({ date: r.date, spent: Number(r.spent) }));
}

/** Day-by-day breakdown for a category over the last N days, oldest first. */
export function getCategoryDailySpend(id: string, days = 30): CategoryDay[] {
  return db
    .all<{ date: string; spent: number; received: number }>(sql`
      SELECT t.date AS date,
             SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS spent,
             SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS received
      FROM transactions t
      WHERE t.pending = 0
        AND ${effectiveCatId("t")} = ${id}
        AND t.date >= date('now', ${`-${days} days`})
      GROUP BY t.date
      ORDER BY t.date ASC`)
    .map((r) => ({ date: r.date, spent: Number(r.spent), received: Number(r.received) }));
}

export type CategoryMonth = { month: string; spent: number; received: number; count: number };

/** Month-by-month breakdown of a category's spend, newest first. */
export function getCategoryMonthlyBreakdown(id: string, months = 12): CategoryMonth[] {
  return db
    .all<{ month: string; spent: number; received: number; count: number }>(sql`
      WITH ${spendRowsCte}
      SELECT substr(sr.date, 1, 7) AS month,
             SUM(CASE WHEN sr.amount > 0 THEN sr.amount ELSE 0 END) AS spent,
             SUM(CASE WHEN sr.amount < 0 THEN -sr.amount ELSE 0 END) AS received,
             COUNT(*) AS count
      FROM spend_rows sr
      WHERE sr.pending = 0 AND sr.category_id = ${id}
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
  matchType: string; // contains | exact | regex
  minAmount: number | null;
  maxAmount: number | null;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  matches: number;
};

/**
 * Auto-tag rules with the count of transactions each currently matches. The
 * count uses the LIKE idiom for every rule regardless of match type, so it is
 * approximate for `regex`/`exact` rules (a cheap indicator, not the exact set).
 */
export function getTagRules(): TagRuleRow[] {
  return db.all<TagRuleRow>(sql`
    SELECT r.id AS id, r.pattern AS pattern, r.label AS label, tg.name AS tagName,
      r.match_type AS matchType, r.min_amount AS minAmount, r.max_amount AS maxAmount,
      r.account_id AS accountId, a.name AS accountName,
      r.category_id AS categoryId, cat.name AS categoryName,
      (SELECT COUNT(*) FROM transactions t
        WHERE (lower(COALESCE(t.merchant_name,'')) LIKE '%' || r.pattern || '%'
           OR lower(t.name) LIKE '%' || r.pattern || '%')
          AND (r.account_id IS NULL OR t.account_id = r.account_id)
          AND (r.min_amount IS NULL OR t.amount >= r.min_amount)
          AND (r.max_amount IS NULL OR t.amount <= r.max_amount)) AS matches
    FROM tag_rules r
    JOIN tags tg ON tg.id = r.tag_id
    LEFT JOIN accounts a ON a.id = r.account_id
    LEFT JOIN categories cat ON cat.id = r.category_id
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
      excluded: accounts.excluded,
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
    // Holdings in a hidden account drop off the Investments page and all
    // downstream P&L / allocation / dividend math.
    .where(eq(accounts.excluded, false))
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

/** Map of targetKey → target percent for every user-set allocation target. */
export function getAllocationTargets(): Record<string, number> {
  const rows = db
    .select({ targetKey: allocationTargets.targetKey, target: allocationTargets.target })
    .from(allocationTargets)
    .all();
  const map: Record<string, number> = {};
  for (const r of rows) map[r.targetKey] = r.target;
  return map;
}

/** Map of sectorKey → user asset-class override (auto-classified when absent). */
export function getAssetClassOverrides(): Record<string, string> {
  const rows = db
    .select({
      sectorKey: investmentAssetClasses.sectorKey,
      assetClass: investmentAssetClasses.assetClass,
    })
    .from(investmentAssetClasses)
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.sectorKey] = r.assetClass;
  return map;
}

/** Map of sectorKey → user geography (region) override; sole source of geo exposure. */
export function getGeographyOverrides(): Record<string, string> {
  const rows = db
    .select({ sectorKey: investmentGeographies.sectorKey, region: investmentGeographies.region })
    .from(investmentGeographies)
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.sectorKey] = r.region;
  return map;
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
    // Transactions from a hidden account are filtered out (trade markers,
    // realized gains, tax lots, dividend income).
    .where(eq(accounts.excluded, false))
    .orderBy(desc(investmentTransactions.date))
    .all();
}

// ── Realized gains / tax lots ─────────────────────────────────────────────────

/** Effective cost-basis method per scope (`sym:AAPL` | `*`), FIFO when absent. */
export function getCostBasisMethods(): Record<string, string> {
  const rows = db
    .select({ scopeKey: costBasisMethod.scopeKey, method: costBasisMethod.method })
    .from(costBasisMethod)
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.scopeKey] = r.method;
  return map;
}

export type TaxLotOverrideRow = {
  id: string;
  sellTxnId: string;
  buyTxnId: string;
  quantity: number;
};

/** All manual spec-ID lot assignments. */
export function getTaxLotOverrides(): TaxLotOverrideRow[] {
  return db
    .select({
      id: taxLotOverrides.id,
      sellTxnId: taxLotOverrides.sellTxnId,
      buyTxnId: taxLotOverrides.buyTxnId,
      quantity: taxLotOverrides.quantity,
    })
    .from(taxLotOverrides)
    .all();
}

export type RealizedGains = {
  /** Realized lots — filtered to `year` when one is supplied, else all. */
  lots: RealizedLot[];
  /** Per-year capital-gains summaries, newest first (always the full history). */
  summaries: YearSummary[];
  /** Aggregate totals for the returned `lots` (the selected scope). */
  totals: Omit<YearSummary, "year">;
  /** Distinct years with realized activity, newest first. */
  years: number[];
  /** The year filter applied, or null for "all years". */
  year: number | null;
};

/**
 * Stitch the investment ledger through lib/tax-lots.ts: reconstruct FIFO/LIFO/
 * spec-ID lots, compute realized P&L + wash-sale flags, and roll up per-year
 * summaries. Pass a `year` to scope the returned lots (summaries stay global so
 * the year picker always has the full set to choose from).
 */
export function getRealizedGains(year?: number): RealizedGains {
  const txns = getInvestmentTransactions();
  const methods = getCostBasisMethods();
  const overrides: LotOverride[] = getTaxLotOverrides().map((o) => ({
    sellTxnId: o.sellTxnId,
    buyTxnId: o.buyTxnId,
    quantity: o.quantity,
  }));

  const all = computeRealizedLots(txns, methods, overrides);
  const summaries = summarizeByYear(all);
  const years = summaries.map((s) => s.year);

  const lots =
    year != null ? all.filter((l) => Number(l.closeDate.slice(0, 4)) === year) : all;

  return { lots, summaries, totals: summarize(lots), years, year: year ?? null };
}

// ── Dividend income ───────────────────────────────────────────────────────────

/** Just the cash-dividend rows from the investment ledger, newest first. */
export function getDividendTransactions(): InvestmentTxnRow[] {
  return getInvestmentTransactions().filter(isDividendTxn);
}

/**
 * Stitch the investment ledger + holdings cost basis through lib/dividends.ts:
 * classify the cash-dividend rows into an income stream (trailing income by
 * month/ticker), compute each position's yield-on-cost, and annualize the
 * trailing cadence into a projected forward annual income.
 */
export function getDividendSummary(): DividendSummary {
  const txns = getInvestmentTransactions();
  const positions = getHoldings().map((h) => ({ ticker: h.ticker, costBasis: h.costBasis }));
  return buildDividendSummary(txns, positions);
}

// ── App settings & FX rates ───────────────────────────────────────────────────

/** Read a single generic app setting (e.g. `displayCurrency`), or null. */
export function getAppSetting(key: string): string | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? null;
}

/**
 * The user's chosen display currency (from app settings), defaulting to USD.
 * Kept here so server components can read the persisted preference without
 * touching the cookie-backed module state in lib/currency.ts.
 */
export function getDisplayCurrencySetting(): string {
  return getAppSetting("displayCurrency") ?? "USD";
}

/**
 * The cached USD-based FX rate map (quote → units per 1 USD) used to convert
 * source-currency figures into the display currency. Empty until the first
 * refresh; callers treat a missing rate as identity.
 */
export function getDisplayCurrencyRates(base = "USD"): Record<string, number> {
  const from = base.trim().toUpperCase();
  const rows = db
    .select({ quote: exchangeRates.quote, rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(eq(exchangeRates.base, from))
    .all();

  const out: Record<string, number> = { [from]: 1 };
  for (const r of rows) out[r.quote.toUpperCase()] = r.rate;
  return out;
}

export function prettyCategory(c: string | null): string {
  if (!c) return "Uncategorized";
  return c
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Sinking funds / savings goals ─────────────────────────────────────────────

/**
 * A savings goal with its ledger-derived progress: `saved` is the running sum of
 * all contributions (deposits minus withdrawals), `remaining` the gap to target,
 * and `pct` the clamped fill percentage for the progress bar.
 */
export type SavingsGoalRow = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  targetAmount: number;
  targetDate: string | null;
  saved: number;
  remaining: number;
  pct: number;
  archived: boolean;
};

/**
 * Every savings goal with its contribution total. Active goals first, then by
 * the user's sort order; archived goals sink to the bottom.
 */
export function getSavingsGoals(): SavingsGoalRow[] {
  return db
    .all<{
      id: string;
      name: string;
      icon: string | null;
      color: string | null;
      targetAmount: number;
      targetDate: string | null;
      archived: number;
      saved: number;
    }>(
      sql`SELECT g.id AS id, g.name AS name, g.icon AS icon, g.color AS color,
             g.target_amount AS targetAmount, g.target_date AS targetDate,
             g.archived AS archived,
             COALESCE((
               SELECT SUM(c.amount) FROM savings_contributions c
               WHERE c.goal_id = g.id
             ), 0) AS saved
          FROM savings_goals g
          ORDER BY g.archived ASC, g.sort_order ASC, g.created_at ASC`,
    )
    .map((r) => {
      const targetAmount = Number(r.targetAmount);
      const saved = Number(r.saved);
      const pct = targetAmount > 0 ? Math.min(Math.max((saved / targetAmount) * 100, 0), 100) : 0;
      return {
        id: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color,
        targetAmount,
        targetDate: r.targetDate,
        saved,
        remaining: targetAmount - saved,
        pct,
        archived: Boolean(r.archived),
      };
    });
}

/** A goal's contribution ledger, newest first, for the audit/history view. */
export function getSavingsGoalContributions(goalId: string): SavingsContribution[] {
  return db
    .select()
    .from(savingsContributions)
    .where(eq(savingsContributions.goalId, goalId))
    .orderBy(desc(savingsContributions.date), desc(savingsContributions.createdAt))
    .all();
}

// ── Period-scoped review queries ──────────────────────────────────────────────
// Explicit [start, end] date bounds ('YYYY-MM-DD', both inclusive) rather than
// the budget month, so /review can summarize any month or year. All exclude
// internal transfers the same way the dashboard does, and stay synchronous.

export type PeriodTotals = {
  income: number;
  expenses: number;
  net: number;
  txCount: number;
};

/**
 * Income / expense / net / count for an arbitrary date window — the review
 * hero numbers. Excludes internal transfers by the transaction's *effective*
 * category group (user override first, else the Plaid-primary mapping), the same
 * way the category breakdown / vendors / heatmap do — so a Zelle payment the user
 * re-tagged as Rent counts here too. `txCount` is the number of expense rows that
 * make up "Total spent" (income rows are excluded from the count).
 */
export function getPeriodTotals(start: string, end: string): PeriodTotals {
  const row = db.get<{ income: number; expenses: number; txCount: number }>(
    sql`SELECT
          SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS income,
          SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS expenses,
          SUM(CASE WHEN t.amount > 0 THEN 1 ELSE 0 END) AS txCount
        FROM transactions t
        LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
        WHERE t.pending = 0
          AND (cat."group" IS NULL OR cat."group" != 'transfer')
          AND t.date >= ${start} AND t.date <= ${end}`,
  );
  const income = Number(row?.income ?? 0);
  const expenses = Number(row?.expenses ?? 0);
  return { income, expenses, net: income - expenses, txCount: Number(row?.txCount ?? 0) };
}

/** getTopMerchants, but over an explicit [start, end] window instead of `days`. */
export function getTopMerchantsForPeriod(
  start: string,
  end: string,
  limit = 8,
): TopMerchant[] {
  return db
    .all<{ vendor: string | null; total: number; count: number }>(
      sql`SELECT COALESCE(t.merchant_name, t.name) AS vendor,
             SUM(t.amount) AS total, COUNT(*) AS count
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND t.date >= ${start} AND t.date <= ${end}
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

/** getSpendingByCategory, but over an explicit [start, end] window. */
export function getCategorySpendForPeriod(start: string, end: string): CategorySpend[] {
  return db
    .all<{ categoryId: string | null; name: string | null; icon: string | null; total: number }>(
      sql`SELECT cat.id AS categoryId, cat.name AS name, cat.icon AS icon, SUM(t.amount) AS total
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND t.date >= ${start} AND t.date <= ${end}
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

export type BiggestPurchase = {
  id: string;
  date: string;
  vendor: string;
  amount: number;
  categoryName: string;
  categoryIcon: string | null;
};

/** The single largest outflows (positive amounts) in the window, transfers excluded. */
export function getBiggestPurchases(
  start: string,
  end: string,
  limit = 6,
): BiggestPurchase[] {
  return db
    .all<{
      id: string;
      date: string;
      name: string;
      merchantName: string | null;
      amount: number;
      categoryName: string | null;
      categoryIcon: string | null;
    }>(
      sql`SELECT t.id AS id, t.date AS date, t.name AS name, t.merchant_name AS merchantName,
             t.amount AS amount, cat.name AS categoryName, cat.icon AS categoryIcon
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE t.pending = 0 AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" != 'transfer')
            AND t.date >= ${start} AND t.date <= ${end}
          ORDER BY t.amount DESC
          LIMIT ${limit}`,
    )
    .map((r) => ({
      id: r.id,
      date: r.date,
      vendor: cleanTransactionName(r.name, r.merchantName),
      amount: Number(r.amount),
      categoryName: r.categoryName ?? "Uncategorized",
      categoryIcon: r.categoryIcon,
    }));
}

/**
 * Total spend per calendar month for `year` ('YYYY'), transfers excluded —
 * feeds the month-by-month review bar. Returns all 12 months (0 for empty
 * ones) so the chart reads as a full year even before it fills in.
 */
export function getMonthlySpendForYear(year: number): { month: string; spent: number }[] {
  const rows = db.all<{ month: string; spent: number }>(
    sql`SELECT substr(date,1,7) AS month,
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS spent
        FROM transactions
        WHERE pending = 0
          AND (category IS NULL OR category NOT IN (${transferPrimaries}))
          AND substr(date,1,4) = ${String(year)}
        GROUP BY month`,
  );
  const byMonth = new Map(rows.map((r) => [r.month, Number(r.spent)]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, spent: byMonth.get(month) ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Custom dashboards
//
// A dashboard is an ordered set of widgets; each widget names a `type` that maps
// to one of the existing query fns above and carries opaque JSON `config` (a day
// window, a limit, etc.). getWidgetData is the single dispatcher the server
// component uses to resolve every widget's data before handing it to the client
// grid, so the widget renderers stay dumb and fully serializable.
// ---------------------------------------------------------------------------

/** The widget kinds a dashboard can render. Shared by the query dispatcher, the picker, and the renderer. */
export type WidgetType =
  | "net-worth"
  | "cashflow"
  | "spend-by-category"
  | "top-vendors"
  | "daily-spend"
  | "budget-summary";

/** Free-form per-widget settings. All optional — each widget falls back to sensible defaults. */
export type WidgetConfig = {
  /** Trailing-day window (spend-by-category, top-vendors). */
  days?: number;
  /** Month count (cashflow). */
  months?: number;
  /** Row cap (top-vendors). */
  limit?: number;
};

export type DashboardListItem = Dashboard & { widgetCount: number };

/** All dashboards, ordered for the sidebar/index, each with its widget count. */
export function getDashboards(): DashboardListItem[] {
  const rows = db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      sortOrder: dashboards.sortOrder,
      createdAt: dashboards.createdAt,
      widgetCount: sql<number>`(
        SELECT COUNT(*) FROM ${dashboardWidgets}
        WHERE ${dashboardWidgets.dashboardId} = ${dashboards.id}
      )`,
    })
    .from(dashboards)
    .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt))
    .all();
  return rows.map((r) => ({ ...r, widgetCount: Number(r.widgetCount) }));
}

/** A single dashboard plus its widgets in display order, or null if it doesn't exist. */
export function getDashboardWithWidgets(
  id: string,
): { dashboard: Dashboard; widgets: DashboardWidget[] } | null {
  const dashboard = db.select().from(dashboards).where(eq(dashboards.id, id)).get();
  if (!dashboard) return null;
  const widgets = db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, id))
    .orderBy(asc(dashboardWidgets.sortOrder))
    .all();
  return { dashboard, widgets };
}

/**
 * Resolved data for one widget — a discriminated union keyed by `type` so the
 * client renderer can switch exhaustively. `daily-spend` carries its window so
 * the heatmap can align its week grid.
 */
export type WidgetData =
  | { type: "net-worth"; series: { date: string; netWorth: number }[] }
  | { type: "cashflow"; series: { month: string; income: number; expenses: number }[] }
  | { type: "spend-by-category"; series: CategorySpend[] }
  | { type: "top-vendors"; merchants: TopMerchant[] }
  | { type: "daily-spend"; series: { date: string; spent: number }[]; start: string; end: string }
  | { type: "budget-summary"; summary: BudgetSummary };

/**
 * Resolve a widget's `type` + `config` to its render-ready data by delegating to
 * the existing query functions. Unknown types are coerced to a spend-by-category
 * fallback so a stale/hand-edited row never crashes a whole dashboard.
 */
export function getWidgetData(type: string, config: WidgetConfig = {}): WidgetData {
  switch (type) {
    case "net-worth":
      return { type: "net-worth", series: getNetWorthSeries() };
    case "cashflow":
      return { type: "cashflow", series: getMonthlyCashflow(config.months ?? 6) };
    case "top-vendors":
      return {
        type: "top-vendors",
        merchants: getTopMerchants(config.days ?? 90, config.limit ?? 8),
      };
    case "daily-spend": {
      // Trailing ~53 weeks, snapped back to a Sunday so the heatmap grid is
      // whole week-columns — mirrors the /review calendar window.
      const end = new Date();
      const startDate = new Date(end);
      startDate.setDate(startDate.getDate() - 364);
      // Back up to the preceding Sunday.
      startDate.setDate(startDate.getDate() - startDate.getDay());
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const start = iso(startDate);
      const endStr = iso(end);
      return {
        type: "daily-spend",
        series: getDailySpendRange(start, endStr),
        start,
        end: endStr,
      };
    }
    case "budget-summary":
      return { type: "budget-summary", summary: getMonthlyBudgetSummary() };
    case "spend-by-category":
    default:
      return { type: "spend-by-category", series: getSpendingByCategory(config.days ?? 30) };
  }
}
