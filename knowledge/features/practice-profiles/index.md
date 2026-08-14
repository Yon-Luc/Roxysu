---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeProfilePage.tsx
  - apps/server/public/components/mania-analysis
  - apps/server/src/routes/beatmaps.ts
---

# Practice profiles

## Purpose

Per-beatmap deep dive: cover, stats, mastery, recent scores, sessions on that map, mania Sunny/Daniel estimates, copyable in-game search string, mania pattern detail (density over time, pattern weights, hotspots).

## Business meaning

“How am I doing on this specific map?”

## Implementation

Mania `GET /api/beatmaps/:id` reads the `.osu` file once and derives pattern detail plus timing from that text. Density samples are two-pointer windows downsampled to about 120 points. Recent scores are a slim 50-row select; sessions on the map are capped.

## Important symbols

- `apps/server/public/features/practice/PracticeProfilePage.tsx`
- `apps/server/public/components/mania-analysis/*` — shared pattern widgets
- `apps/server/src/routes/beatmaps.ts`

## Dependencies

- `features/practice-library/`
- `features/mastery-settings/`
- `features/sunny-dan-recommendations/`
- `features/sessions/`

## Depended on by

- (detail surface from library / sessions)
- `features/now-selected/` — reuses mania analysis widgets

## Related knowledge

- [features/now-selected/](../now-selected/index.md)
