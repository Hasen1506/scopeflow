CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`hits` integer NOT NULL
);
