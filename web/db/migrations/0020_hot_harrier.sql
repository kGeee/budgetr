CREATE TABLE `option_iv_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`expiry` text NOT NULL,
	`strike` real NOT NULL,
	`right` text NOT NULL,
	`iv` real NOT NULL,
	`iv_solved` integer DEFAULT false NOT NULL,
	`underlying` real,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `iv_snap_key_idx` ON `option_iv_snapshots` (`ticker`,`date`,`expiry`,`strike`,`right`);--> statement-breakpoint
CREATE INDEX `iv_snap_series_idx` ON `option_iv_snapshots` (`ticker`,`expiry`,`date`);