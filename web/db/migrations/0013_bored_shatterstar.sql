ALTER TABLE `tag_rules` ADD `match_type` text DEFAULT 'contains' NOT NULL;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `min_amount` real;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `max_amount` real;--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `tag_rules` ADD `category_id` text REFERENCES categories(id);