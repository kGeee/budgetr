CREATE TABLE `cost_basis_method` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_lot_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`sell_txn_id` text NOT NULL,
	`buy_txn_id` text NOT NULL,
	`quantity` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tax_lot_overrides_sell_idx` ON `tax_lot_overrides` (`sell_txn_id`);