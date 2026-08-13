---
last_verified: 2026-08
confidence: verified
touches:
  - packages/sunny-dan
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/analytics/recommend
---

# Sunny dan & 7K recommendations

## Purpose

Parse `.osu` charts from lazer storage, run Sunny Rework–style estimates, cache dan labels / Sunny stars, expose them in the query language, and power 7K smart recommendations (Push / Consistency / Deficit / Skillset).

## Business rules

1. Estimates are cached (e.g. `beatmap_dan_ratings`); recommendations degrade without backfill.
2. Backfill is a Settings-started background job.

## Important symbols

- `packages/sunny-dan`
- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/analytics/recommend/*`
- `GET /api/practice/recommend`

## Dependencies

- `features/mastery-settings/` — job controls
- `features/practice-library/` — `dan:` / `sunny:` QL fields
- `packages/osu-chart`

## Depended on by

- `features/sessions/` — 7K suggest
- `features/practice-profiles/` — mania estimates

## Related knowledge

- [flows/sunny-backfill-to-recommend.md](../../flows/sunny-backfill-to-recommend.md)
