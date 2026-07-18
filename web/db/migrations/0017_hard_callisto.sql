CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`broker` text,
	`account_id` text,
	`file_name` text,
	`file_hash` text,
	`rows_parsed` integer DEFAULT 0 NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`date_start` text,
	`date_end` text,
	`symbol_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'preview' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`broker` text,
	`name` text NOT NULL,
	`header_fingerprint` text NOT NULL,
	`mapping` text NOT NULL,
	`sign_convention` text,
	`date_format` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`numerator` real NOT NULL,
	`denominator` real NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `splits_ticker_idx` ON `stock_splits` (`ticker`);--> statement-breakpoint
CREATE UNIQUE INDEX `splits_ticker_date_idx` ON `stock_splits` (`ticker`,`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_manual_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text,
	`name` text NOT NULL,
	`type` text,
	`quantity` real,
	`cost_basis` real,
	`manual_value` real,
	`iso_currency_code` text,
	`wallet_id` text,
	`contract_address` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_manual_holdings`("id", "symbol", "name", "type", "quantity", "cost_basis", "manual_value", "iso_currency_code", "wallet_id", "contract_address", "created_at", "updated_at") SELECT "id", "symbol", "name", "type", "quantity", "cost_basis", "manual_value", "iso_currency_code", "wallet_id", "contract_address", "created_at", "updated_at" FROM `manual_holdings`;--> statement-breakpoint
DROP TABLE `manual_holdings`;--> statement-breakpoint
ALTER TABLE `__new_manual_holdings` RENAME TO `manual_holdings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `investment_transactions` ADD `source` text DEFAULT 'plaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `investment_transactions` ADD `import_batch_id` text REFERENCES import_batches(id);--> statement-breakpoint
CREATE INDEX `invtx_batch_idx` ON `investment_transactions` (`import_batch_id`);