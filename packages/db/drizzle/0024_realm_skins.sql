CREATE TABLE `realm_skins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`creator` text,
	`hash` text,
	`protected` integer DEFAULT false NOT NULL,
	`delete_pending` integer DEFAULT false NOT NULL,
	`instantiation_info` text,
	`has_skin_ini` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `realm_skins_importable_idx` ON `realm_skins` (`delete_pending`,`has_skin_ini`);
--> statement-breakpoint
CREATE TABLE `realm_skin_files` (
	`skin_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	PRIMARY KEY(`skin_id`, `filename`),
	FOREIGN KEY (`skin_id`) REFERENCES `realm_skins`(`id`) ON UPDATE no action ON DELETE cascade
);
