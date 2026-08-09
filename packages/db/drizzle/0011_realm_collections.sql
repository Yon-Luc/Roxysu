CREATE TABLE `realm_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`last_modified` integer,
	`hash_count` integer DEFAULT 0 NOT NULL,
	`resolved_set_count` integer DEFAULT 0 NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `realm_collection_hashes` (
	`collection_id` text NOT NULL,
	`md5_hash` text NOT NULL,
	`beatmapset_online_id` integer,
	PRIMARY KEY(`collection_id`, `md5_hash`),
	FOREIGN KEY (`collection_id`) REFERENCES `realm_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `realm_collection_hashes_md5_idx` ON `realm_collection_hashes` (`md5_hash`);
