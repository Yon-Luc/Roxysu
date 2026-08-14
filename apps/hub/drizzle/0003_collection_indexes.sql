DELETE FROM `collection_maps` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `collection_maps` GROUP BY `collection_id`, `beatmapset_id`
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collections_owner_id_idx` ON `collections` (`owner_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collections_created_at_idx` ON `collections` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_maps_collection_id_idx` ON `collection_maps` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `collection_maps_collection_set_unique` ON `collection_maps` (`collection_id`, `beatmapset_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_tags_tag_idx` ON `collection_tags` (`tag`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_favorites_collection_id_idx` ON `collection_favorites` (`collection_id`);
