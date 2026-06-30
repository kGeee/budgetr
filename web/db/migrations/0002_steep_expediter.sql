CREATE TABLE `tag_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_budgets_tag_id_unique` ON `tag_budgets` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`label` text,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_rules_tag_idx` ON `tag_rules` (`tag_id`);