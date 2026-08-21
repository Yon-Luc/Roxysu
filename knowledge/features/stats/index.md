---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/stats.ts
  - apps/server/src/analytics/playerStats.ts
  - apps/server/public/features/stats
---

# Stats

## Purpose

Player skill bands / axes and related aggregate practice statistics beyond the dashboard glance.

## Implementation

`getPlayerStats` loads mania scores for the selected keymode once, then derives summary, rank mix, skillset mix, play-time patterns, mapper ranks, and skill history in memory. Day skill history is sampled to about 60 points. The client keeps previous chart data while filters change, defers below-fold Recharts, and invalidates `["stats"]` on `sync.finished` / `dashboard.updated` (`refetchType: "active"`).

## Mod gate

Analytics only aggregate scores that are nomod or use only non-gameplay-affecting mods: Mirror (`MR`) and Classic (`CL`), including MR+CL combos. The gate is `isNomodOrMirrorOnly()` in `packages/mania-judge/src/mods.ts` (via the `apps/server/src/replay/mods.ts` re-export) and also gates PP estimation in `apps/server/src/mania-rating/estimateScorePp.ts`.

## Important symbols

- `apps/server/src/routes/stats.ts`
- `apps/server/src/analytics/playerStats.ts`
- `apps/server/public/features/stats/*`

## Dependencies

- `features/live-sync/` — Realm extraction
- analytics pipeline (`apps/server/src/analytics/pipeline.ts`)

## Depended on by

- (presentation surface)
