ALTER TABLE `play_settings` ADD `lane_keys_json` text DEFAULT '["s","d","f","space","j","k","l"]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `play_settings` ADD `last_beatmap_id` text;
