CREATE TABLE `hub_added_collections` (
	`hub_collection_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`beatmapset_ids_json` text DEFAULT '[]' NOT NULL,
	`hub_updated_at` integer NOT NULL,
	`lazer_collection_id` text,
	`lazer_synced_at` integer,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
