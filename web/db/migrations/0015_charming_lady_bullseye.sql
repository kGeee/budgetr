CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`chain` text NOT NULL,
	`address` text NOT NULL,
	`label` text NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `manual_holdings` ADD `wallet_id` text REFERENCES wallets(id);--> statement-breakpoint
ALTER TABLE `manual_holdings` ADD `contract_address` text;