import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
  },
  (t) => [index("tx_date_idx").on(t.date), index("tx_account_idx").on(t.accountId)],
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
