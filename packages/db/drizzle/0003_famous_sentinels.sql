ALTER TABLE `imports` ADD `rows_changed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `scores_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `beatmaps_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `beatmap_sets_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `changed_score_ids` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `changed_beatmap_ids` text;