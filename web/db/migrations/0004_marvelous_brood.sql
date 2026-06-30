CREATE TABLE `vendor_group_members` (
	`vendor_key` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `vendor_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vgm_group_idx` ON `vendor_group_members` (`group_id`);--> statement-breakpoint
CREATE TABLE `vendor_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
