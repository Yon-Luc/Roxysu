CREATE TABLE `collection_favorites` (
	`user_id` integer NOT NULL,
	`collection_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `collection_id`),
	FOREIGN KEY (`user_id`) REFERENCES `hub_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection_maps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`beatmapset_id` integer NOT NULL,
	`map_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection_tags` (
	`collection_id` integer NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`collection_id`, `tag`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `hub_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `hub_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`osu_id` integer NOT NULL,
	`username` text NOT NULL,
	`avatar_url` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_users_osu_id_unique` ON `hub_users` (`osu_id`);--> statement-breakpoint
CREATE TABLE `search_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query_hash` text NOT NULL,
	`query_params` text NOT NULL,
	`beatmapset_ids` text DEFAULT '[]' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`cached_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_cache_query_hash_unique` ON `search_cache` (`query_hash`);