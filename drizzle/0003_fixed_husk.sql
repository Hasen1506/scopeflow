CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`baseline_version` integer NOT NULL,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`ref` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledger_project_seq` ON `ledger_entries` (`project_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledger_project_ref` ON `ledger_entries` (`project_id`,`ref`);