CREATE TABLE `dismissed_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_key` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	`snooze_until` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_alert_key_idx` ON `dismissed_alerts` (`alert_key`);