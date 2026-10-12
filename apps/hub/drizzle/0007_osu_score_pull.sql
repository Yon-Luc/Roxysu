CREATE TABLE `osu_score_pulls` (
	`osu_user_id` integer NOT NULL,
	`ruleset` text NOT NULL,
	`top_score_id` integer,
	`score_count` integer DEFAULT 0 NOT NULL,
	`complete_at` integer,
	`status` text DEFAULT 'idle' NOT NULL,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`message` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`osu_user_id`, `ruleset`)
);
--> statement-breakpoint
CREATE TABLE `osu_best_scores` (
	`osu_user_id` integer NOT NULL,
	`ruleset` text NOT NULL,
	`score_id` integer NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`osu_user_id`, `ruleset`, `score_id`)
);
--> statement-breakpoint
CREATE TABLE `osu_api_usage` (
	`minute_bucket` integer PRIMARY KEY NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`cache_hits` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT 0 NOT NULL,
	`not_found` integer DEFAULT 0 NOT NULL,
	`limited` integer DEFAULT 0 NOT NULL,
	`other` integer DEFAULT 0 NOT NULL,
	`lowest_remaining` integer
);
--> statement-breakpoint
CREATE TABLE `osu_api_park` (
	`id` integer PRIMARY KEY NOT NULL,
	`parked_until` integer
);
