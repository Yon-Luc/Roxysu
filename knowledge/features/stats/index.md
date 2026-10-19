---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/routes/stats.ts
  - apps/server/src/analytics/playerStats.ts
  - apps/server/src/analytics/playerStats.test.ts
  - apps/server/src/analytics/playerStats.fixture.ts
  - apps/server/src/analytics/playerStatsCache.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/stats
---

# Stats

## Purpose

Player skill bands / axes and related aggregate practice statistics beyond the dashboard glance.

## Implementation

`getPlayerStats` resolves the username and gamemode score filters once, then streams the mania scores of the selected keymode in a single pass (`streamManiaPass`) that folds each play into summary, rank mix, play-time patterns, daily/weekly progression buckets, and mapper aggregates, keeping only a compact per-play record (non-hidden plays) for skill history and skillset mix. No full row array is retained. SQL aggregates for rank mix / play-time / counts were measured and rejected: they re-scan the join and cost more than the in-memory work they replace. Day skill history is sampled to about 60 points. The client keeps previous chart data while filters change, defers below-fold Recharts, and invalidates `["stats"]` on `sync.finished` / `dashboard.updated` (`refetchType: "active"`).

Keymode scopes the whole page and stays in the header. Axis and top-plays sit with Current skill. Day/week only samples skill history, so it sits on that chart. Range windows skill history and progression, so the same control appears on both.

## Business rules

1. Every Stats figure uses the active score filters (Settings username and gamemode, resolved once per request) and excludes `delete_pending` scores. This includes the header `sessionCount` and `pbCount` and the session averages (`getSessionStats`).
   **Enforced by:** `scoreScopeFilter` in `apps/server/src/analytics/playerStats.ts` (same conditions as `countSessionPbs` in `session.ts`) — status: verified (`playerStats.test.ts`)
2. A session counts only if it contains at least one scoped play; its play count in "plays per session" and "longest" is its scoped plays, not the stored `sessions.score_count`. Session start/end times are the stored values. `pbCount` is every scoped `score_metrics.is_pb` row, including PBs outside any session.
   **Enforced by:** `getSessionStats` — status: verified

## Mod gate

Volume/accuracy aggregates (play counts, rank mix, play-time patterns, summary, daily/weekly/mapper trends) include **all** played scores regardless of mods; stored Realm PP is already mod-aware.

Difficulty-dependent views use the dan difficulty variants store: skill axes, skill history, and skillset mix read variant stars/LN ratio for modded plays (rate ≠ 1.0 or full-LN Invert); modded plays without a computed variant are excluded until rated. NM-equivalent plays (rate 1.0, no Invert; Mirror/Classic ignored) always read the base Sunny dan ratings store.

PP curve estimation stays NM-only (`resolveScorePp` in `apps/server/src/mania-rating/estimateScorePp.ts`): modded scores contribute their stored Realm PP when present, never a curve estimate. Session `is_pb` and `pbCompare` rank by the same resolved PP (see `features/sessions/`), so a score's PB status agrees with mastery `best_pp`.

## Stats cache invalidation

`playerStatsCache` (10 min TTL) clears on `score.imported`, `score.updated`, `sync.finished`, `mastery.updated`, and explicitly on:

1. Customize changes to axis thresholds or recommend focus settings (`PATCH /api/settings` calls `invalidatePlayerStatsCache()`), because skill history and skillset mix read them at compute time.
2. A finished dan variant job run that wrote variant rows (`danVariantJob.ts:finish`), because modded plays only count once a variant exists.

`dashboard.updated` alone never clears it.

## Important symbols

- `apps/server/src/routes/stats.ts`
- `apps/server/src/analytics/playerStats.ts`
- `apps/server/src/analytics/playerStatsCache.ts`
- `apps/server/public/features/stats/*`

## Dependencies

- `features/live-sync/` — Realm extraction
- analytics pipeline (`apps/server/src/analytics/pipeline.ts`)

## Depended on by

- (presentation surface)
