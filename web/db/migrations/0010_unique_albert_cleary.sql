CREATE TABLE `transaction_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`txn_a_id` text NOT NULL,
	`txn_b_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`txn_a_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`txn_b_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_matches_pair_idx` ON `transaction_matches` (`txn_a_id`,`txn_b_id`);--> statement-breakpoint
CREATE INDEX `txn_matches_a_idx` ON `transaction_matches` (`txn_a_id`);--> statement-breakpoint
CREATE INDEX `txn_matches_b_idx` ON `transaction_matches` (`txn_b_id`);