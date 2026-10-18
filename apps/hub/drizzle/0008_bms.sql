ALTER TABLE `hub_users` ADD `country_code` text;
--> statement-breakpoint
ALTER TABLE `hub_users` ADD `bms_profile_public` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `bms_charts` (
	`md5` text PRIMARY KEY NOT NULL,
	`sha256` text,
	`title` text,
	`artist` text,
	`key_count` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bms_charts_sha256_idx` ON `bms_charts` (`sha256`);
--> statement-breakpoint
CREATE TABLE `bms_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`installation_id` text NOT NULL,
	`local_score_id` text NOT NULL,
	`chart_md5` text NOT NULL,
	`achieved_at` integer NOT NULL,
	`ex_score` integer,
	`max_ex_score` integer,
	`normalized_score` integer,
	`accuracy` real,
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
	`mods_json` text NOT NULL,
	`trust` text DEFAULT 'community_submitted' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `hub_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chart_md5`) REFERENCES `bms_charts`(`md5`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bms_scores_source_unique` ON `bms_scores` (`user_id`,`installation_id`,`local_score_id`);
--> statement-breakpoint
CREATE INDEX `bms_scores_user_variant_idx` ON `bms_scores` (`user_id`,`variant_id`,`achieved_at`);
--> statement-breakpoint
CREATE INDEX `bms_scores_chart_idx` ON `bms_scores` (`chart_md5`);
--> statement-breakpoint
CREATE TABLE `bms_score_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`installation_id` text NOT NULL,
	`local_score_id` text NOT NULL,
	`score_id` text,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `hub_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`score_id`) REFERENCES `bms_scores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bms_score_submissions_source_unique` ON `bms_score_submissions` (`user_id`,`installation_id`,`local_score_id`);
--> statement-breakpoint
CREATE TABLE `bms_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`symbol` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bms_table_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`source_url` text NOT NULL,
	`level_order_json` text NOT NULL,
	`unresolved_count` integer DEFAULT 0 NOT NULL,
	`imported_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `bms_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bms_table_versions_table_imported_idx` ON `bms_table_versions` (`table_id`,`imported_at`);
--> statement-breakpoint
CREATE TABLE `bms_table_entries` (
	`version_id` text NOT NULL,
	`chart_hash` text NOT NULL,
	`hash_kind` text NOT NULL,
	`sha256` text,
	`level` text NOT NULL,
	`level_index` integer NOT NULL,
	`title` text,
	`artist` text,
	PRIMARY KEY(`version_id`, `chart_hash`),
	FOREIGN KEY (`version_id`) REFERENCES `bms_table_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bms_table_entries_version_level_idx` ON `bms_table_entries` (`version_id`,`level_index`);
