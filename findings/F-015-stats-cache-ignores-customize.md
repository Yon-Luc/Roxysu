---
id: F-015
feature: stats
kind: logic-gap
severity: medium
confidence: verified
status: fixed
---

# Stats cache ignores Customize changes

## What

Changing axis thresholds or recommend-focus settings invalidates the query-context cache and does not invalidate `playerStatsCache`. The stats cache key does not include those settings. Cached `/stats` payloads can keep the previous skill bands for up to ten minutes.

## Why

`shouldInvalidate` clears the cache on score, sync, and mastery events. It intentionally ignores `dashboard.updated`. The settings route never calls `invalidatePlayerStatsCache` on the customize branch. Skill history and skillset mix are computed from `readAxisThresholdsSync` and `readFocusSettingsSync` only on a cache miss.

## How to improve

Call `invalidatePlayerStatsCache()` when `axisThresholdsChanged` or `focusSettingsChanged`, or put the serialized thresholds and focus settings in the cache key.

## Potential gain

Customize applies on the next Stats view instead of looking like a no-op until the TTL or the next score import.

## Evidence

- `apps/server/src/routes/settings.ts` (lines 566–568): customize branch only calls `invalidateQueryContextCache()`.
- `apps/server/src/analytics/playerStatsCache.ts` `shouldInvalidate` (lines 47–55): no settings event.
- `apps/server/src/analytics/playerStats.ts` (about lines 491–536): thresholds and focus are read at compute time.

## Status

Fixed. `PATCH /api/settings` now calls `invalidatePlayerStatsCache()` when axis thresholds or recommend focus settings change (`apps/server/src/routes/settings.ts`), in addition to the query-context invalidation. Covered by `apps/server/src/routes/settings.statsCache.test.ts` (changed thresholds drop the cache; an unchanged payload keeps it).
