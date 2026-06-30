CREATE TABLE `holding_cost_basis_overrides` (
	`holding_id` text PRIMARY KEY NOT NULL,
	`total_cost` real,
	`unit_cost` real,
	`as_of_date` text,
	`note` text,
	`updated_at` integer NOT NULL
);
