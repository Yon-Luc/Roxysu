ALTER TABLE `search_cache` ADD `refresh_interval_minutes` integer;
--> statement-breakpoint
ALTER TABLE `search_cache` ADD `last_refresh_at` integer;
--> statement-breakpoint
ALTER TABLE `search_cache` ADD `refresh_error` text;
--> statement-breakpoint
ALTER TABLE `search_cache` ADD `refresh_backoff_until` integer;
