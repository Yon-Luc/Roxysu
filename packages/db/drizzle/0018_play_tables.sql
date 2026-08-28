CREATE TABLE `play_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`scroll_speed` real DEFAULT 400 NOT NULL,
	`master_volume` real DEFAULT 0.85 NOT NULL,
	`countdown_seconds` integer DEFAULT 3 NOT NULL,
	`user_offset_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `play_settings` (`id`, `updated_at`) VALUES (1, (unixepoch() * 1000));
--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`beatmap_id` text NOT NULL,
	`total_score` integer NOT NULL,
	`accuracy` real NOT NULL,
	`max_combo` integer NOT NULL,
	`perfect` integer DEFAULT 0 NOT NULL,
	`great` integer DEFAULT 0 NOT NULL,
	`good` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT 0 NOT NULL,
	`meh` integer DEFAULT 0 NOT NULL,
	`miss` integer DEFAULT 0 NOT NULL,
	`played_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `play_sessions_beatmap_id_idx` ON `play_sessions` (`beatmap_id`);--> statement-breakpoint
CREATE INDEX `play_sessions_played_at_idx` ON `play_sessions` (`played_at`);
