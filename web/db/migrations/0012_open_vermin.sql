CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`file_path` text NOT NULL,
	`mime_type` text,
	`size` integer,
	`original_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_txn_idx` ON `attachments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_filters_created_idx` ON `saved_filters` (`created_at`);--> statement-breakpoint
CREATE TABLE `transaction_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`txn_a_id` text NOT NULL,
	`txn_b_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`txn_a_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`txn_b_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_matches_pair_idx` ON `transaction_matches` (`txn_a_id`,`txn_b_id`);--> statement-breakpoint
CREATE INDEX `txn_matches_a_idx` ON `transaction_matches` (`txn_a_id`);--> statement-breakpoint
CREATE INDEX `txn_matches_b_idx` ON `transaction_matches` (`txn_b_id`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text,
	`amount` real NOT NULL,
	`note` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tx_splits_txn_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `tx_splits_category_idx` ON `transaction_splits` (`category_id`);--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `match_type` text DEFAULT 'contains' NOT NULL;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `min_amount` real;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `max_amount` real;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `category_id` text REFERENCES categories(id);