-- Remove Sunny and Daniel estimator rows; rework (mania-difficulty) is the
-- sole mania difficulty source. Keep sunny_star column (shared star field).
DELETE FROM beatmap_dan_ratings WHERE algorithm IN ('sunny', 'daniel');--> statement-breakpoint
DELETE FROM beatmap_dan_rating_variants WHERE algorithm IN ('sunny', 'daniel');
