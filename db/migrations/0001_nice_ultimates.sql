CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category_id_unique` ON `budgets` (`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`group` text DEFAULT 'spending' NOT NULL,
	`plaid_primary` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_plaid_primary_idx` ON `categories` (`plaid_primary`);--> statement-breakpoint
CREATE TABLE `recurring_streams` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`description` text,
	`merchant_name` text,
	`category` text,
	`frequency` text,
	`average_amount` real,
	`last_amount` real,
	`last_date` text,
	`predicted_next_date` text,
	`iso_currency_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`status` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_account_idx` ON `recurring_streams` (`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_next_idx` ON `recurring_streams` (`predicted_next_date`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_tag_idx` ON `transaction_tags` (`tag_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `user_category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `notes` text;--> statement-breakpoint
CREATE INDEX `tx_reviewed_idx` ON `transactions` (`reviewed`);