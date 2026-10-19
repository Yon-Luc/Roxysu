---
id: F-018
feature: stats
kind: logic-gap
severity: medium
confidence: verified
---

# Finished dan-variant job does not refresh stats

## What

When the dan-variant job finishes it publishes `dashboard.updated` only. The player-stats cache ignores that event on purpose. Modded skill numbers stay at the pre-variant result until a score import, a sync, or the TTL.

## Why

Skill axes skip a modded play until a variant row exists (`danRatingFor` returns null when the mods need a variant and none is stored). Filling the variant does not change scores, so the usual invalidation events do not fire.

## How to improve

On a variant batch that wrote rows, publish an event the stats cache already honors, or call `invalidatePlayerStatsCache()` from `finish()`.

## Potential gain

Skill charts update when mod ratings land, without waiting up to ten minutes.

## Evidence

- `apps/server/src/map-analysis/danVariantJob.ts` `finish` (lines 116–122): `publish({ type: "dashboard.updated" })`.
- `apps/server/src/analytics/playerStatsCache.ts` (lines 47–50): comment and check that skip `dashboard.updated`.
- `apps/server/src/analytics/playerStats.ts` `danRatingFor` (about lines 224–235): missing variant drops the play.
