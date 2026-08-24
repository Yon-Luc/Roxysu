CREATE INDEX `scores_user_pending_ruleset_beatmap_idx` ON `scores` (`user_username`,`delete_pending`,`ruleset_short_name`,`beatmap_id`);--> statement-breakpoint
CREATE INDEX `scores_beatmap_pending_idx` ON `scores` (`beatmap_id`,`delete_pending`);
