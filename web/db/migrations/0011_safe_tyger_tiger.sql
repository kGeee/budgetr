CREATE TABLE `budget_rollovers` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`carry_in` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_rollover_cat_month_idx` ON `budget_rollovers` (`category_id`,`month`);--> statement-breakpoint
ALTER TABLE `budgets` ADD `rollover` integer DEFAULT false NOT NULL;