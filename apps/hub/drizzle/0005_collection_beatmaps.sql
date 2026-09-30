CREATE TABLE `collection_beatmaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`beatmapset_id` integer NOT NULL,
	`beatmap_id` integer NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_beatmaps_collection_id_idx` ON `collection_beatmaps` (`collection_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_beatmaps_collection_beatmap_unique` ON `collection_beatmaps` (`collection_id`, `beatmap_id`);
