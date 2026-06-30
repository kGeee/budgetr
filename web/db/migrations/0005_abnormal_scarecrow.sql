CREATE TABLE `investment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`security_id` text,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`subtype` text,
	`quantity` real,
	`amount` real,
	`price` real,
	`fees` real,
	`iso_currency_code` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invtx_account_idx` ON `investment_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `invtx_security_idx` ON `investment_transactions` (`security_id`);--> statement-breakpoint
CREATE INDEX `invtx_date_idx` ON `investment_transactions` (`date`);