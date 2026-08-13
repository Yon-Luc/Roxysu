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

## Important symbols

- `apps/server/src/routes/stats.ts`
- `apps/server/src/analytics/playerStats.ts`
- `apps/server/public/features/stats/*`

## Dependencies

- `features/live-sync/`
- analytics pipeline (`apps/server/src/analytics/pipeline.ts`)

## Depended on by

- (presentation surface)
