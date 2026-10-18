CREATE TABLE `bms_score_details` (
	`score_id` text PRIMARY KEY NOT NULL,
	`ex_score` integer,
	`max_ex_score` integer,
	`normalized_score` integer NOT NULL,
	`accuracy` real NOT NULL,
	`pgreat` integer,
	`great` integer,
	`good` integer,
	`bad` integer,
	`poor` integer,
	`miss` integer,
	`variant_id` text NOT NULL,
	`gauge_id` text,
	`combo_lamp_id` text,
	`clear_lamp_id` text,
	`dj_grade` text,
	`mod_acronyms` text NOT NULL,
	`autoplay` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bms_score_details_variant_idx` ON `bms_score_details` (`variant_id`);
--> statement-breakpoint
CREATE TABLE `bms_sync_queue` (
	`score_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`hub_score_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bms_sync_queue_state_next_idx` ON `bms_sync_queue` (`state`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `bms_table_cache` (
	`version_id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`imported_at` integer NOT NULL,
	`level_order_json` text NOT NULL,
	`entries_json` text NOT NULL,
	`unresolved_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bms_table_cache_table_imported_idx` ON `bms_table_cache` (`table_id`,`imported_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bms_table_cache_source_version_unique` ON `bms_table_cache` (`table_id`,`version_id`);
