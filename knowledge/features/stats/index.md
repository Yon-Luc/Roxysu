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

## Important symbols

- `apps/server/src/routes/stats.ts`
- `apps/server/src/analytics/playerStats.ts`
- `apps/server/public/features/stats/*`

## Dependencies

- `features/live-sync/` — Realm extraction
- analytics pipeline (`apps/server/src/analytics/pipeline.ts`)

## Depended on by

- (presentation surface)
