CREATE TABLE `allocation_targets` (
	`target_key` text PRIMARY KEY NOT NULL,
	`target` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investment_asset_classes` (
	`sector_key` text PRIMARY KEY NOT NULL,
	`asset_class` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investment_geographies` (
	`sector_key` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL
);
