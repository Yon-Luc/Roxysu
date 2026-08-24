CREATE TABLE `beatmap_dan_rating_variants` (
	`beatmap_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`rate` real NOT NULL,
	`ln_only` integer NOT NULL,
	`beatmap_hash` text,
	`sunny_star` real,
	`ln_ratio` real,
	`column_count` integer,
	`est_diff` text,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`beatmap_id`, `algorithm`, `rate`, `ln_only`),
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beatmap_dan_rating_variants_algorithm_idx` ON `beatmap_dan_rating_variants` (`algorithm`);
