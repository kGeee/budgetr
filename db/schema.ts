import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * A Plaid "Item" = one connection to one financial institution.
 * The access token is stored encrypted (AES-256-GCM) — never in plaintext.
 */
export const items = sqliteTable("items", {
  id: text("id").primaryKey(), // Plaid item_id
  accessToken: text("access_token").notNull(), // encrypted blob
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  transactionsCursor: text("transactions_cursor"), // /transactions/sync cursor
  status: text("status").notNull().default("active"), // active | error
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(), // Plaid account_id
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  officialName: text("official_name"),
  mask: text("mask"),
  type: text("type").notNull(), // depository | credit | investment | loan | other
  subtype: text("subtype"),
  currentBalance: real("current_balance"),
  availableBalance: real("available_balance"),
  isoCurrencyCode: text("iso_currency_code"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Plaid convention: positive = money leaving the account (spending),
    // negative = money entering (income/credit).
    amount: real("amount").notNull(),
    isoCurrencyCode: text("iso_currency_code"),
    date: text("date").notNull(), // YYYY-MM-DD
    name: text("name").notNull(),
    merchantName: text("merchant_name"),
    category: text("category"), // personal_finance_category.primary
    categoryDetailed: text("category_detailed"), // personal_finance_category.detailed
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    paymentChannel: text("payment_channel"),
    // --- User overlay (never written by Plaid sync; see lib/sync.ts set: clauses) ---
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    userCategoryId: text("user_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (t) => [
    index("tx_date_idx").on(t.date),
    index("tx_account_idx").on(t.accountId),
    index("tx_reviewed_idx").on(t.reviewed),
  ],
);

/**
 * User-facing spending/income categories. Seeded one-per-Plaid-primary so every
 * transaction maps somewhere; users can add, rename, and archive their own.
 * `plaidPrimary` is the personal_finance_category.primary this category absorbs
 * (null for purely user-created categories).
 */
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"), // lucide icon name or emoji
    color: text("color"), // hex / token, optional
    group: text("group").notNull().default("spending"), // income | spending | transfer
    plaidPrimary: text("plaid_primary"), // maps a Plaid primary category here
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("category_plaid_primary_idx").on(t.plaidPrimary)],
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
});

export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.tagId] }),
    index("transaction_tags_tag_idx").on(t.tagId),
  ],
);

/** Rolling monthly budget — one amount per category. */
export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
});

/** Rolling monthly budget scoped to a tag — overlaps category budgets intentionally. */
export const tagBudgets = sqliteTable("tag_budgets", {
  id: text("id").primaryKey(),
  tagId: text("tag_id")
    .notNull()
    .unique()
    .references(() => tags.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
});

/**
 * Auto-tagging rule: when a transaction's merchant/name contains `pattern`
 * (stored lowercased), apply `tagId`. Applied on sync and backfilled on create.
 */
export const tagRules = sqliteTable(
  "tag_rules",
  {
    id: text("id").primaryKey(),
    pattern: text("pattern").notNull(),
    label: text("label"), // human-readable vendor the rule was created from
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("tag_rules_tag_idx").on(t.tagId)],
);

/**
 * Recurring transaction streams from Plaid /transactions/recurring/get.
 * Plaid-owned (re-synced), keyed by stream_id.
 */
export const recurringStreams = sqliteTable(
  "recurring_streams",
  {
    id: text("id").primaryKey(), // Plaid stream_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // inflow | outflow
    description: text("description"),
    merchantName: text("merchant_name"),
    category: text("category"), // personal_finance_category.primary
    frequency: text("frequency"), // WEEKLY | MONTHLY | ...
    averageAmount: real("average_amount"),
    lastAmount: real("last_amount"),
    lastDate: text("last_date"), // YYYY-MM-DD
    predictedNextDate: text("predicted_next_date"), // YYYY-MM-DD
    isoCurrencyCode: text("iso_currency_code"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    status: text("status"), // MATURE | EARLY_DETECTION | ...
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("recurring_account_idx").on(t.accountId),
    index("recurring_next_idx").on(t.predictedNextDate),
  ],
);

export const securities = sqliteTable("securities", {
  id: text("id").primaryKey(), // Plaid security_id
  name: text("name"),
  tickerSymbol: text("ticker_symbol"),
  type: text("type"),
  closePrice: real("close_price"),
  isoCurrencyCode: text("iso_currency_code"),
});

export const holdings = sqliteTable(
  "holdings",
  {
    id: text("id").primaryKey(), // `${accountId}:${securityId}`
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id),
    quantity: real("quantity").notNull(),
    costBasis: real("cost_basis"),
    institutionPrice: real("institution_price"),
    institutionValue: real("institution_value"),
    isoCurrencyCode: text("iso_currency_code"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("holdings_account_idx").on(t.accountId)],
);

/**
 * One row per account per day — the raw material for net-worth-over-time.
 * `balance` is signed: assets positive, liabilities (credit/loan) negative.
 */
export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    balance: real("balance").notNull(),
    type: text("type").notNull(),
    isoCurrencyCode: text("iso_currency_code"),
  },
  (t) => [uniqueIndex("snapshot_account_date_idx").on(t.accountId, t.date)],
);

export type Item = typeof items.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Security = typeof securities.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type TagBudget = typeof tagBudgets.$inferSelect;
export type TagRule = typeof tagRules.$inferSelect;
export type RecurringStream = typeof recurringStreams.$inferSelect;
