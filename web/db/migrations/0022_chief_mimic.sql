CREATE TABLE `wallet_token_rules` (
	`holding_id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`label` text,
	`contract_address` text,
	`hidden` integer DEFAULT false NOT NULL,
	`cost_basis` real,
	`hidden_value_usd` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `manual_holdings` ADD `last_value_usd` real;--> statement-breakpoint
ALTER TABLE `wallets` ADD `min_value_usd` real;--> statement-breakpoint
-- Backfill: cost bases already set on wallet holdings become rules, which are
-- now authoritative over the (re-created on every sync) holding row.
INSERT INTO `wallet_token_rules` (`holding_id`, `wallet_id`, `label`, `contract_address`, `hidden`, `cost_basis`, `created_at`, `updated_at`)
SELECT `id`, `wallet_id`, `name`, `contract_address`, 0, `cost_basis`, unixepoch(), unixepoch()
FROM `manual_holdings`
WHERE `wallet_id` IS NOT NULL AND `cost_basis` IS NOT NULL;