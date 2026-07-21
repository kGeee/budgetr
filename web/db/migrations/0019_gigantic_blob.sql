CREATE TABLE `expense_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`shared_expense_id` text NOT NULL,
	`person_id` text NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`shared_expense_id`) REFERENCES `shared_expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_shares_pair_idx` ON `expense_shares` (`shared_expense_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `expense_shares_person_idx` ON `expense_shares` (`person_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`handle` text,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`transaction_id` text,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_txn_idx` ON `settlements` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `settlements_person_idx` ON `settlements` (`person_id`);--> statement-breakpoint
CREATE TABLE `shared_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`my_share` real NOT NULL,
	`note` text,
	`items_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_expenses_txn_idx` ON `shared_expenses` (`transaction_id`);--> statement-breakpoint
-- Hand-added: the holding category the bill splitter parks reimbursable money in.
-- In the `transfer` group so it drops out of spend/income reporting. Idempotent,
-- and matches lib/seed-categories-data.ts so fresh installs land on the same row.
INSERT INTO `categories` (`id`, `name`, `icon`, `group`, `plaid_primary`, `sort_order`, `archived`)
VALUES ('cat_reimbursable', 'Reimbursable', 'Users', 'transfer', NULL, 16, false)
ON CONFLICT (`id`) DO NOTHING;