---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeProfilePage.tsx
  - apps/server/public/components/ScoreCard.tsx
  - apps/server/public/components/mania-analysis
  - apps/server/src/routes/beatmaps.ts
  - apps/server/src/scores/parseStatistics.ts
---

# Practice profiles

## Purpose

Per-beatmap deep dive: cover, core stats, recent scores with judgment detail, sessions on that map, mania Sunny/Daniel/Rework estimates, copyable in-game search string, mania pattern detail (density over time, pattern weights, hotspots).

## Business meaning

“How am I doing on this specific map?”

## Business rules

1. Map Page mini-stats show Plays, Best Acc, and Last played — not Best PP.
2. Map Page does not surface Mastery or Timing Analysis panels.
3. Secondary map actions (Export Map, Export Set, View on website) live in a More menu; Preview, Open in osu!, and Copy search stay primary.
4. Score Timeline uses the shared `ScoreCard` (`variant="compact"`), including judgment counts parsed from local mirror `scores.statistics` when present. Session detail uses the same component with `variant="beatmap"` (cover + PB compare).

## Implementation

Mania `GET /api/beatmaps/:id` reads the `.osu` file once for pattern detail. Density samples are two-pointer windows downsampled to about 120 points. Recent scores are a slim 50-row select that includes parsed `judgments`; sessions on the map are capped. Timing analysis is no longer computed for this endpoint.

## Important symbols

- `apps/server/public/features/practice/PracticeProfilePage.tsx`
- `apps/server/public/components/ScoreCard.tsx` — shared score row (`compact` on Map Page; `beatmap` + `pbCompare` on sessions)
- `apps/server/public/components/mania-analysis/*` — shared pattern widgets
- `apps/server/src/routes/beatmaps.ts`
- `apps/server/src/scores/parseStatistics.ts:parseScoreStatistics()`

## Dependencies

- `features/practice-library/`
- `features/mastery-settings/` — mastery still exists for Practice library / query language; not shown on Map Page
- `features/sunny-dan-recommendations/`
- `features/sessions/`

## Depended on by

- (detail surface from library / sessions)
- `features/now-selected/` — reuses mania analysis widgets
- `features/sessions/` — session detail score lists use `ScoreCard` beatmap variant

## Related knowledge

- [features/now-selected/](../now-selected/index.md)
- [features/sessions/](../sessions/index.md)
