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
  // Plaid environment the access token was issued under (sandbox | production).
  // Tokens are env-scoped: a sandbox token is invalid in production and vice
  // versa, so sync uses this to detect stale links and prompt a re-link.
  plaidEnv: text("plaid_env"),
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

/**
 * A user-defined canonical vendor name that multiple raw vendor keys can be
 * merged into (e.g. "Amazon" absorbs "AMZN Mktp US", "Amazon Prime", etc.).
 */
export const vendorGroups = sqliteTable("vendor_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/**
 * Maps a raw vendor key (COALESCE(merchant_name, name)) to a vendor group.
 * One raw key can belong to at most one group.
 */
export const vendorGroupMembers = sqliteTable(
  "vendor_group_members",
  {
    vendorKey: text("vendor_key").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => vendorGroups.id, { onDelete: "cascade" }),
  },
  (t) => [index("vgm_group_idx").on(t.groupId)],
);

/**
 * Investment activity from Plaid (buys, sells, dividends, fees, transfers).
 * Unlike `holdings` (current snapshot), this is the historical ledger used to
 * reconstruct what was held on any past date and to mark trades on the
 * per-ticker price charts. `quantity` is positive for buys, negative for sells.
 */
export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: text("id").primaryKey(), // Plaid investment_transaction_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Null for cash-only activity (e.g. account fees) with no associated security.
    securityId: text("security_id").references(() => securities.id),
    date: text("date").notNull(), // YYYY-MM-DD
    name: text("name").notNull(),
    type: text("type"), // buy | sell | cash | fee | transfer | cancel
    subtype: text("subtype"),
    quantity: real("quantity"), // + buy, - sell
    amount: real("amount"), // + cash debited (buy), - cash credited (sell)
    price: real("price"),
    fees: real("fees"),
    isoCurrencyCode: text("iso_currency_code"),
  },
  (t) => [
    index("invtx_account_idx").on(t.accountId),
    index("invtx_security_idx").on(t.securityId),
    index("invtx_date_idx").on(t.date),
  ],
);

/**
 * User-entered holdings that live outside Plaid — crypto, assets at
 * un-linkable institutions, or fixed-value items (e.g. cash, a gold bar).
 *
 * Two flavours, distinguished by `symbol`:
 *  - Tickered  (symbol set, e.g. "BTC-USD"): valued as quantity × market price,
 *    auto-priced from Yahoo with a full history chart.
 *  - Fixed-value (symbol null): valued at the user-set `manualValue`, no chart.
 *
 * Kept in its own table so the Plaid holdings prune in lib/sync.ts can never
 * touch them.
 */
export const manualHoldings = sqliteTable("manual_holdings", {
  id: text("id").primaryKey(),
  // Market symbol Yahoo understands (BTC-USD, ETH-USD, a stock ticker). Null
  // marks a fixed-value asset valued by `manualValue`.
  symbol: text("symbol"),
  name: text("name").notNull(),
  type: text("type"), // crypto | stock | cash | other
  quantity: real("quantity"), // tickered assets
  costBasis: real("cost_basis"),
  manualValue: real("manual_value"), // fixed-value assets
  isoCurrencyCode: text("iso_currency_code"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Single sector assignment per investment, keyed so it spans both `holdings`
 * (Plaid) and `manual_holdings`. The key is the uppercased ticker symbol
 * (prefixed `sym:`) so every position of the same ticker — across accounts and
 * across Plaid/manual — shares one sector; symbol-less fixed-value manual
 * holdings fall back to `man:${manualHoldingId}`. One row = one assignment, so
 * allocation percentages always sum cleanly to 100%.
 */
export const investmentSectors = sqliteTable("investment_sectors", {
  sectorKey: text("sector_key").primaryKey(),
  sector: text("sector").notNull(),
});

/**
 * User corrections to a Plaid holding's cost basis. Kept in its own table so the
 * `holdings` sync (which overwrites cost_basis from Plaid on every run) can never
 * clobber a manual correction — e.g. after a brokerage transfer/merger (TD
 * Ameritrade → Schwab) that re-dates lots and resets the reported basis.
 *
 * Either figure may be set; `unit_cost` (avg cost/share) is preferred when
 * present since it stays correct as quantity changes, otherwise `total_cost` is
 * used as-is. `as_of_date` is informational (e.g. the transfer date).
 */
export const holdingCostBasisOverrides = sqliteTable("holding_cost_basis_overrides", {
  holdingId: text("holding_id").primaryKey(), // matches holdings.id (`${accountId}:${securityId}`)
  totalCost: real("total_cost"), // user-entered total $ basis for the whole position
  unitCost: real("unit_cost"), // user-entered average cost per share
  asOfDate: text("as_of_date"), // YYYY-MM-DD, optional (e.g. transfer date)
  note: text("note"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Overlay that divides one transaction's amount across several categories. Purely
 * additive: a transaction with no rows here still resolves through
 * effectiveCatId() exactly as before; once it has splits, each split's `amount`
 * lands in its own category for category/budget reporting instead of the whole
 * amount landing in one. Split amounts are expected to sum to the parent
 * transaction's signed amount — enforced in the setTransactionSplits action.
 */
export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    // Null (or an archived category) simply reports as Uncategorized; the FK
    // clears rather than blocking a category delete.
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amount: real("amount").notNull(), // same sign convention as transactions.amount
    note: text("note"),
  },
  (t) => [
    index("tx_splits_txn_idx").on(t.transactionId),
    index("tx_splits_category_idx").on(t.categoryId),
  ],
);

/**
 * Links two offsetting transactions so they can be excluded from cashflow and
 * category spend (avoiding double-counting). Two flavours by `kind`:
 *  - `transfer`: a transfer out of one account matched to the transfer in on
 *    another (different accounts, opposite signs, equal magnitude).
 *  - `refund`: a purchase matched to its later refund (same account).
 *
 * Suggestions are computed in lib/matching.ts; the user confirms or dismisses
 * each. A `dismissed` row is a tombstone — it suppresses the pair from ever
 * being re-suggested without excluding the transactions from reporting. Only
 * `confirmed` rows drive the exclusion. Additive overlay: transactions with no
 * row here report exactly as before.
 */
export const transactionMatches = sqliteTable(
  "transaction_matches",
  {
    id: text("id").primaryKey(),
    txnAId: text("txn_a_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    txnBId: text("txn_b_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // refund | transfer
    status: text("status").notNull().default("confirmed"), // confirmed | dismissed
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("txn_matches_pair_idx").on(t.txnAId, t.txnBId),
    index("txn_matches_a_idx").on(t.txnAId),
    index("txn_matches_b_idx").on(t.txnBId),
  ],
);

export type Item = typeof items.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Security = typeof securities.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type ManualHolding = typeof manualHoldings.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type TagBudget = typeof tagBudgets.$inferSelect;
export type TagRule = typeof tagRules.$inferSelect;
export type RecurringStream = typeof recurringStreams.$inferSelect;
export type VendorGroup = typeof vendorGroups.$inferSelect;
export type VendorGroupMember = typeof vendorGroupMembers.$inferSelect;
export type InvestmentSector = typeof investmentSectors.$inferSelect;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type TransactionMatch = typeof transactionMatches.$inferSelect;
