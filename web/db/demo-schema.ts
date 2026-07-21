/**
 * Full SQLite DDL for the in-memory demo database used by the read-only web demo
 * (the DEMO_DB build served on the marketing site — see db/index.ts). Serverless
 * has no writable/persistent filesystem, so the demo DB is created in memory at
 * cold start, this schema is exec'd, then lib/demo-data.ts seeds it.
 *
 * Generated from the migrated schema (drizzle) — backtick identifiers rewritten
 * to double-quotes so the DDL can live in a template literal, and the
 * __drizzle_migrations bookkeeping table omitted. Regenerate after a schema
 * change with: scripts/gen-demo-schema.sh (dumps a freshly-migrated DB).
 */

export const DEMO_SCHEMA_SQL = `
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" text NOT NULL,
	"subtype" text,
	"current_balance" real,
	"available_balance" real,
	"iso_currency_code" text,
	"updated_at" integer NOT NULL, "excluded" integer DEFAULT false NOT NULL, "source" text DEFAULT 'plaid' NOT NULL,
	FOREIGN KEY ("item_id") REFERENCES "items"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "allocation_targets" (
	"target_key" text PRIMARY KEY NOT NULL,
	"target" real NOT NULL
);
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"original_name" text,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "balance_snapshots" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"account_id" text NOT NULL,
	"date" text NOT NULL,
	"balance" real NOT NULL,
	"type" text NOT NULL,
	"iso_currency_code" text,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "budget_rollovers" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"month" text NOT NULL,
	"carry_in" real DEFAULT 0 NOT NULL,
	FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"amount" real NOT NULL, "rollover" integer DEFAULT false NOT NULL,
	FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"group" text DEFAULT 'spending' NOT NULL,
	"plaid_primary" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" integer DEFAULT false NOT NULL
);
CREATE TABLE "cost_basis_method" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL
);
CREATE TABLE "dashboard_widgets" (
	"id" text PRIMARY KEY NOT NULL,
	"dashboard_id" text NOT NULL,
	"type" text NOT NULL,
	"config" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" integer
);
CREATE TABLE "dismissed_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_key" text NOT NULL,
	"dismissed_at" integer NOT NULL,
	"snooze_until" text
);
CREATE TABLE "exchange_rates" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" real NOT NULL,
	"as_of" integer NOT NULL,
	PRIMARY KEY("base", "quote")
);
CREATE TABLE "expense_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"shared_expense_id" text NOT NULL,
	"person_id" text NOT NULL,
	"amount" real NOT NULL,
	FOREIGN KEY ("shared_expense_id") REFERENCES "shared_expenses"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("person_id") REFERENCES "people"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "fire_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"annual_expenses" real,
	"safe_withdrawal_rate" real DEFAULT 4 NOT NULL,
	"expected_return" real DEFAULT 7 NOT NULL,
	"monthly_contribution" real,
	"target_retirement_age" integer,
	"updated_at" integer NOT NULL
);
CREATE TABLE "holding_cost_basis_overrides" (
	"holding_id" text PRIMARY KEY NOT NULL,
	"total_cost" real,
	"unit_cost" real,
	"as_of_date" text,
	"note" text,
	"updated_at" integer NOT NULL
);
CREATE TABLE "holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"security_id" text NOT NULL,
	"quantity" real NOT NULL,
	"cost_basis" real,
	"institution_price" real,
	"institution_value" real,
	"iso_currency_code" text,
	"updated_at" integer NOT NULL,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"broker" text,
	"account_id" text,
	"file_name" text,
	"file_hash" text,
	"rows_parsed" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"date_start" text,
	"date_end" text,
	"symbol_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "import_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"broker" text,
	"name" text NOT NULL,
	"header_fingerprint" text NOT NULL,
	"mapping" text NOT NULL,
	"sign_convention" text,
	"date_format" text,
	"created_at" integer NOT NULL
);
CREATE TABLE "investment_asset_classes" (
	"sector_key" text PRIMARY KEY NOT NULL,
	"asset_class" text NOT NULL
);
CREATE TABLE "investment_geographies" (
	"sector_key" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL
);
CREATE TABLE "investment_sectors" (
	"sector_key" text PRIMARY KEY NOT NULL,
	"sector" text NOT NULL
);
CREATE TABLE "investment_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"security_id" text,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"subtype" text,
	"quantity" real,
	"amount" real,
	"price" real,
	"fees" real,
	"iso_currency_code" text, "source" text DEFAULT 'plaid' NOT NULL, "import_batch_id" text REFERENCES import_batches(id),
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"transactions_cursor" text,
	"status" text DEFAULT 'active' NOT NULL,
	"error" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
, "plaid_env" text, "source" text DEFAULT 'plaid' NOT NULL);
CREATE TABLE "manual_holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text,
	"name" text NOT NULL,
	"type" text,
	"quantity" real,
	"cost_basis" real,
	"manual_value" real,
	"iso_currency_code" text,
	"wallet_id" text,
	"contract_address" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "net_worth_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"amount" real NOT NULL,
	"achieved_date" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
CREATE TABLE "option_iv_snapshots" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"expiry" text NOT NULL,
	"strike" real NOT NULL,
	"right" text NOT NULL,
	"iv" real NOT NULL,
	"iv_solved" integer DEFAULT false NOT NULL,
	"underlying" real,
	"captured_at" integer NOT NULL
);
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"color" text,
	"archived" integer DEFAULT false NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE "recurring_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"direction" text NOT NULL,
	"description" text,
	"merchant_name" text,
	"category" text,
	"frequency" text,
	"average_amount" real,
	"last_amount" real,
	"last_date" text,
	"predicted_next_date" text,
	"iso_currency_code" text,
	"is_active" integer DEFAULT true NOT NULL,
	"status" text,
	"updated_at" integer NOT NULL,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "saved_filters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE "savings_contributions" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"amount" real NOT NULL,
	"date" text NOT NULL,
	"note" text,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "savings_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"target_amount" real NOT NULL,
	"target_date" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" integer DEFAULT false NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE "securities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"ticker_symbol" text,
	"type" text,
	"close_price" real,
	"iso_currency_code" text
);
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"transaction_id" text,
	"amount" real NOT NULL,
	"date" text NOT NULL,
	"note" text,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("person_id") REFERENCES "people"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "shared_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"my_share" real NOT NULL,
	"note" text,
	"items_json" text,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "stock_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"numerator" real NOT NULL,
	"denominator" real NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE "tag_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text NOT NULL,
	"amount" real NOT NULL,
	FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "tag_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"label" text,
	"tag_id" text NOT NULL,
	"created_at" integer NOT NULL, "match_type" text DEFAULT 'contains' NOT NULL, "min_amount" real, "max_amount" real, "account_id" text REFERENCES accounts(id), "category_id" text REFERENCES categories(id),
	FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text
);
CREATE TABLE "tax_lot_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"sell_txn_id" text NOT NULL,
	"buy_txn_id" text NOT NULL,
	"quantity" real NOT NULL
);
CREATE TABLE "transaction_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"txn_a_id" text NOT NULL,
	"txn_b_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("txn_a_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("txn_b_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "transaction_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"category_id" text,
	"amount" real NOT NULL,
	"note" text,
	FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON UPDATE no action ON DELETE set null
);
CREATE TABLE "transaction_tags" (
	"transaction_id" text NOT NULL,
	"tag_id" text NOT NULL,
	PRIMARY KEY("transaction_id", "tag_id"),
	FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"amount" real NOT NULL,
	"iso_currency_code" text,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"category" text,
	"category_detailed" text,
	"pending" integer DEFAULT false NOT NULL,
	"payment_channel" text, "reviewed" integer DEFAULT false NOT NULL, "user_category_id" text REFERENCES categories(id), "notes" text,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "vendor_group_members" (
	"vendor_key" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	FOREIGN KEY ("group_id") REFERENCES "vendor_groups"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "vendor_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" integer NOT NULL
);
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"last_synced_at" integer,
	"last_error" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
, "last_value_usd" real, "last_token_count" integer);
CREATE INDEX "attachments_txn_idx" ON "attachments" ("transaction_id");
CREATE UNIQUE INDEX "budget_rollover_cat_month_idx" ON "budget_rollovers" ("category_id","month");
CREATE UNIQUE INDEX "budgets_category_id_unique" ON "budgets" ("category_id");
CREATE UNIQUE INDEX "category_plaid_primary_idx" ON "categories" ("plaid_primary");
CREATE INDEX "dashboard_widgets_dash_idx" ON "dashboard_widgets" ("dashboard_id");
CREATE UNIQUE INDEX "dismissed_alert_key_idx" ON "dismissed_alerts" ("alert_key");
CREATE UNIQUE INDEX "expense_shares_pair_idx" ON "expense_shares" ("shared_expense_id","person_id");
CREATE INDEX "expense_shares_person_idx" ON "expense_shares" ("person_id");
CREATE INDEX "holdings_account_idx" ON "holdings" ("account_id");
CREATE INDEX "invtx_account_idx" ON "investment_transactions" ("account_id");
CREATE INDEX "invtx_batch_idx" ON "investment_transactions" ("import_batch_id");
CREATE INDEX "invtx_date_idx" ON "investment_transactions" ("date");
CREATE INDEX "invtx_security_idx" ON "investment_transactions" ("security_id");
CREATE UNIQUE INDEX "iv_snap_key_idx" ON "option_iv_snapshots" ("ticker","date","expiry","strike","right");
CREATE INDEX "iv_snap_series_idx" ON "option_iv_snapshots" ("ticker","expiry","date");
CREATE INDEX "recurring_account_idx" ON "recurring_streams" ("account_id");
CREATE INDEX "recurring_next_idx" ON "recurring_streams" ("predicted_next_date");
CREATE INDEX "saved_filters_created_idx" ON "saved_filters" ("created_at");
CREATE INDEX "savings_contributions_goal_idx" ON "savings_contributions" ("goal_id");
CREATE INDEX "settlements_person_idx" ON "settlements" ("person_id");
CREATE UNIQUE INDEX "settlements_txn_idx" ON "settlements" ("transaction_id");
CREATE UNIQUE INDEX "shared_expenses_txn_idx" ON "shared_expenses" ("transaction_id");
CREATE UNIQUE INDEX "snapshot_account_date_idx" ON "balance_snapshots" ("account_id","date");
CREATE UNIQUE INDEX "splits_ticker_date_idx" ON "stock_splits" ("ticker","date");
CREATE INDEX "splits_ticker_idx" ON "stock_splits" ("ticker");
CREATE UNIQUE INDEX "tag_budgets_tag_id_unique" ON "tag_budgets" ("tag_id");
CREATE INDEX "tag_rules_tag_idx" ON "tag_rules" ("tag_id");
CREATE INDEX "tax_lot_overrides_sell_idx" ON "tax_lot_overrides" ("sell_txn_id");
CREATE INDEX "transaction_tags_tag_idx" ON "transaction_tags" ("tag_id");
CREATE INDEX "tx_account_idx" ON "transactions" ("account_id");
CREATE INDEX "tx_date_idx" ON "transactions" ("date");
CREATE INDEX "tx_reviewed_idx" ON "transactions" ("reviewed");
CREATE INDEX "tx_splits_category_idx" ON "transaction_splits" ("category_id");
CREATE INDEX "tx_splits_txn_idx" ON "transaction_splits" ("transaction_id");
CREATE INDEX "txn_matches_a_idx" ON "transaction_matches" ("txn_a_id");
CREATE INDEX "txn_matches_b_idx" ON "transaction_matches" ("txn_b_id");
CREATE UNIQUE INDEX "txn_matches_pair_idx" ON "transaction_matches" ("txn_a_id","txn_b_id");
CREATE INDEX "vgm_group_idx" ON "vendor_group_members" ("group_id");
`;
