CREATE TABLE `api_keys` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_owner` ON `api_keys` (`owner`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`latest` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`token` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`signer` text,
	`comment` text,
	`created` text NOT NULL,
	`decided` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_project_version` ON `versions` (`project_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_token` ON `versions` (`token`);