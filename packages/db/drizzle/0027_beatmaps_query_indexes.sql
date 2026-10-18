CREATE INDEX `beatmaps_last_local_update_idx` ON `beatmaps` (`last_local_update`);--> statement-breakpoint
CREATE INDEX `beatmaps_ruleset_cs_idx` ON `beatmaps` (`ruleset_short_name`,`circle_size`);
