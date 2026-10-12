CREATE TABLE `online_score_candidates` (
	`score_id` integer PRIMARY KEY NOT NULL,
	`ruleset` text NOT NULL,
	`osu_user_id` integer NOT NULL,
	`beatmap_online_id` integer NOT NULL,
	`version_mismatch` integer DEFAULT false NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
