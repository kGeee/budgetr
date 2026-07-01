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
