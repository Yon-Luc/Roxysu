CREATE TABLE `search_index_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_id` integer NOT NULL,
	`beatmapset_id` integer NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`creator` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`bpm` real,
	`favourite_count` integer DEFAULT 0 NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`has_video` integer DEFAULT false NOT NULL,
	`ranked_date` text,
	`length_seconds` integer,
	`position` integer NOT NULL,
	FOREIGN KEY (`cache_id`) REFERENCES `search_cache`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `search_index_sets_cache_position_idx` ON `search_index_sets` (`cache_id`,`position`);--> statement-breakpoint
CREATE INDEX `search_index_sets_cache_bpm_idx` ON `search_index_sets` (`cache_id`,`bpm`);--> statement-breakpoint
CREATE INDEX `search_index_sets_cache_length_idx` ON `search_index_sets` (`cache_id`,`length_seconds`);--> statement-breakpoint
CREATE UNIQUE INDEX `search_index_sets_cache_set_unique` ON `search_index_sets` (`cache_id`,`beatmapset_id`);--> statement-breakpoint
CREATE TABLE `search_index_diffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_row_id` integer NOT NULL,
	`beatmap_id` integer NOT NULL,
	`version` text DEFAULT 'Unknown' NOT NULL,
	`stars` real DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'osu' NOT NULL,
	`mode_int` integer DEFAULT 0 NOT NULL,
	`keys` integer,
	`total_length` integer,
	FOREIGN KEY (`set_row_id`) REFERENCES `search_index_sets`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `search_index_diffs_set_stars_idx` ON `search_index_diffs` (`set_row_id`,`stars`);
