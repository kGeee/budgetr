CREATE TABLE `manual_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text,
	`name` text NOT NULL,
	`type` text,
	`quantity` real,
	`cost_basis` real,
	`manual_value` real,
	`iso_currency_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
