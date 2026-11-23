---
id: F3-008
feature: analytics
kind: logic-gap
severity: low
confidence: verified
status: fixed
---

# Play counts change with the timezone offset

## What

With `tzOffset = 0` the dashboard snapshot and the Sessions calendar read stored
`daily_stats`. With any non-zero offset they recount from `scores`.

The two universes differ: `runStatisticsEngine` requires `beatmap_id IS NOT NULL`, the
recount does not. Seven scores in the local mirror have no `beatmaps` row, so "plays today",
the 7-day count, the streak and the calendar can each shift by one when the client sends a
different offset.

## Why

Two implementations of the same day count with different scope: the statistics engine joins
through `isNotNull(scores.beatmapId)`; `getCalendarActivity` filters only
`delete_pending`/username/gamemode.

## How to improve

Pick one scope and apply it in both places. Adding `beatmap_id IS NOT NULL` (or a join to
`beatmaps`) to `getCalendarActivity` is the smaller change and matches what the dashboard
shows today.

## Evidence

- `apps/server/src/analytics/statistics.ts:148-155`, `:261-269` - engine requires a beatmap
- `apps/server/src/analytics/progression.ts:128-156` - recount does not
- `apps/server/src/analytics/practiceSnapshot.ts:61-77` - offset branch

## Status

Fixed 2026-11-23. `getCalendarActivity` recount excludes scores with a null `beatmap_id`, matching `runStatisticsEngine`, so a timezone offset no longer changes the day count by the orphan scores.
