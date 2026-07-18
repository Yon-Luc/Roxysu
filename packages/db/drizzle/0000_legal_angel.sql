CREATE TABLE `beatmap_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`online_id` integer NOT NULL,
	`date_added` integer NOT NULL,
	`date_submitted` integer,
	`date_ranked` integer,
	`status` integer NOT NULL,
	`delete_pending` integer DEFAULT false NOT NULL,
	`hash` text,
	`protected` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `beatmap_sets_online_id_idx` ON `beatmap_sets` (`online_id`);--> statement-breakpoint
CREATE TABLE `beatmap_tags` (
	`beatmap_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`beatmap_id`, `tag_id`),
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `beatmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`online_id` integer NOT NULL,
	`set_id` text NOT NULL,
	`difficulty_name` text,
	`ruleset_short_name` text,
	`status` integer NOT NULL,
	`length` real NOT NULL,
	`bpm` real NOT NULL,
	`star_rating` real NOT NULL,
	`md5_hash` text,
	`hash` text,
	`hidden` integer DEFAULT false NOT NULL,
	`total_object_count` integer DEFAULT 0 NOT NULL,
	`end_time_object_count` integer DEFAULT 0 NOT NULL,
	`last_played` integer,
	`drain_rate` real,
	`circle_size` real,
	`overall_difficulty` real,
	`approach_rate` real,
	`slider_multiplier` real,
	`slider_tick_rate` real,
	`title` text,
	`title_unicode` text,
	`artist` text,
	`artist_unicode` text,
	`source` text,
	`tags` text,
	`preview_time` integer,
	`audio_file` text,
	`background_file` text,
	`mapper_online_id` integer,
	`mapper_username` text,
	`offset` real,
	`last_local_update` integer,
	`last_online_update` integer,
	FOREIGN KEY (`set_id`) REFERENCES `beatmap_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beatmaps_online_id_idx` ON `beatmaps` (`online_id`);--> statement-breakpoint
CREATE INDEX `beatmaps_md5_hash_idx` ON `beatmaps` (`md5_hash`);--> statement-breakpoint
CREATE INDEX `beatmaps_set_id_idx` ON `beatmaps` (`set_id`);--> statement-breakpoint
CREATE TABLE `daily_stats` (
	`day` text PRIMARY KEY NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`total_pp` real DEFAULT 0 NOT NULL,
	`avg_accuracy` real
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`realm_schema_version` integer NOT NULL,
	`beatmap_sets_upserted` integer DEFAULT 0 NOT NULL,
	`beatmaps_upserted` integer DEFAULT 0 NOT NULL,
	`scores_upserted` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `mapper_stats` (
	`mapper_online_id` integer PRIMARY KEY NOT NULL,
	`mapper_username` text,
	`play_count` integer DEFAULT 0 NOT NULL,
	`total_pp` real DEFAULT 0 NOT NULL,
	`avg_accuracy` real
);
--> statement-breakpoint
CREATE TABLE `mastery` (
	`beatmap_id` text PRIMARY KEY NOT NULL,
	`level` real DEFAULT 0 NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`best_accuracy` real,
	`best_pp` real,
	`last_played_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`beatmap_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rulesets` (
	`short_name` text PRIMARY KEY NOT NULL,
	`online_id` integer NOT NULL,
	`name` text,
	`available` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rulesets_online_id_idx` ON `rulesets` (`online_id`);--> statement-breakpoint
CREATE TABLE `score_metrics` (
	`score_id` text PRIMARY KEY NOT NULL,
	`retry_index` integer,
	`is_pb` integer DEFAULT false NOT NULL,
	`session_id` integer,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`online_id` integer NOT NULL,
	`legacy_online_id` integer NOT NULL,
	`beatmap_id` text,
	`beatmap_hash` text,
	`ruleset_short_name` text,
	`client_version` text,
	`total_score` integer DEFAULT 0 NOT NULL,
	`total_score_without_mods` integer DEFAULT 0 NOT NULL,
	`legacy_total_score` integer,
	`max_combo` integer DEFAULT 0 NOT NULL,
	`combo` integer DEFAULT 0 NOT NULL,
	`accuracy` real DEFAULT 0 NOT NULL,
	`pp` real,
	`rank` integer DEFAULT 0 NOT NULL,
	`mods` text,
	`statistics` text,
	`maximum_statistics` text,
	`played_at` integer NOT NULL,
	`user_online_id` integer,
	`user_username` text,
	`is_legacy_score` integer DEFAULT false NOT NULL,
	`delete_pending` integer DEFAULT false NOT NULL,
	`hash` text,
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scores_online_id_idx` ON `scores` (`online_id`);--> statement-breakpoint
CREATE INDEX `scores_legacy_online_id_idx` ON `scores` (`legacy_online_id`);--> statement-breakpoint
CREATE INDEX `scores_beatmap_id_idx` ON `scores` (`beatmap_id`);--> statement-breakpoint
CREATE INDEX `scores_played_at_idx` ON `scores` (`played_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`score_count` integer DEFAULT 0 NOT NULL,
	`ruleset_short_name` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `weekly_stats` (
	`week_start` text PRIMARY KEY NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`total_pp` real DEFAULT 0 NOT NULL,
	`avg_accuracy` real
);
