CREATE TABLE `budget_rollovers` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`carry_in` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_rollover_cat_month_idx` ON `budget_rollovers` (`category_id`,`month`);--> statement-breakpoint
CREATE TABLE `dismissed_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_key` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	`snooze_until` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_alert_key_idx` ON `dismissed_alerts` (`alert_key`);--> statement-breakpoint
CREATE TABLE `fire_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`annual_expenses` real,
	`safe_withdrawal_rate` real DEFAULT 4 NOT NULL,
	`expected_return` real DEFAULT 7 NOT NULL,
	`monthly_contribution` real,
	`target_retirement_age` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `net_worth_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`amount` real NOT NULL,
	`achieved_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `savings_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_contributions_goal_idx` ON `savings_contributions` (`goal_id`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`target_amount` real NOT NULL,
	`target_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `budgets` ADD `rollover` integer DEFAULT false NOT NULL;