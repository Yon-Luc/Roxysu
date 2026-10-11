CREATE TABLE `calc_bundles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roxysu_version` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`algorithms` text DEFAULT '[]' NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`uploaded_by_user_id` integer,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `hub_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calc_bundles_roxysu_version_unique` ON `calc_bundles` (`roxysu_version`);
--> statement-breakpoint
CREATE TABLE `calc_bundle_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bundle_id` integer NOT NULL,
	`beatmap_hash` text NOT NULL,
	`online_beatmap_id` integer,
	`algorithm` text NOT NULL,
	`sunny_star` real,
	`ln_ratio` real,
	`column_count` integer,
	`est_diff` text,
	`dominant_pattern` text,
	`secondary_pattern` text,
	`confidence` real,
	`jack_density` real,
	`chord_density` real,
	`stream_density` real,
	`bracket_density` real,
	`chordjack_score` real,
	`jumpstream_score` real,
	`chordstream_score` real,
	FOREIGN KEY (`bundle_id`) REFERENCES `calc_bundles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calc_bundle_entries_bundle_hash_algo_unique` ON `calc_bundle_entries` (`bundle_id`,`beatmap_hash`,`algorithm`);
--> statement-breakpoint
CREATE INDEX `calc_bundle_entries_bundle_algo_idx` ON `calc_bundle_entries` (`bundle_id`,`algorithm`);
