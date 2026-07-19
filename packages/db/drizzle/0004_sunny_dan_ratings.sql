CREATE TABLE `beatmap_dan_ratings` (
	`beatmap_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`beatmap_hash` text,
	`sunny_star` real,
	`ln_ratio` real,
	`column_count` integer,
	`est_diff` text,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`beatmap_id`, `algorithm`),
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
