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

Volume/accuracy aggregates (play counts, rank mix, play-time patterns, summary, daily/weekly/mapper trends) include **all** played scores regardless of mods; stored Realm PP is already mod-aware.

Difficulty-dependent views use the dan difficulty variants store: skill axes, skill history, and skillset mix read variant stars/LN ratio for modded plays (rate ≠ 1.0 or full-LN Invert); modded plays without a computed variant are excluded until rated. NM-equivalent plays (rate 1.0, no Invert; Mirror/Classic ignored) always read the base Sunny dan ratings store.

PP curve estimation stays NM-only (`resolveScorePp` in `apps/server/src/mania-rating/estimateScorePp.ts`): modded scores contribute their stored Realm PP when present, never a curve estimate.

## Important symbols

- `apps/server/src/routes/stats.ts`
- `apps/server/src/analytics/playerStats.ts`
- `apps/server/public/features/stats/*`

## Dependencies

- `features/live-sync/` — Realm extraction
- analytics pipeline (`apps/server/src/analytics/pipeline.ts`)

## Depended on by

- (presentation surface)
