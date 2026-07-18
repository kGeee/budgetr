ALTER TABLE `accounts` ADD `source` text DEFAULT 'plaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `source` text DEFAULT 'plaid' NOT NULL;