CREATE TABLE `beatmap_mania_ratings` (
	`beatmap_id` text NOT NULL,
	`version_id` text NOT NULL,
	`beatmap_hash` text,
	`star_rating` real,
	`star_rating_ss` real,
	`pp_ss` real,
	`attributes_json` text,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`beatmap_id`, `version_id`),
	FOREIGN KEY (`beatmap_id`) REFERENCES `beatmaps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beatmap_mania_ratings_version_idx` ON `beatmap_mania_ratings` (`version_id`);
