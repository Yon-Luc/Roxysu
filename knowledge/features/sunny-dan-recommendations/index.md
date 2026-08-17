---
last_verified: 2026-08
confidence: verified
touches:
  - packages/sunny-dan
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/analytics/recommend
---

# Sunny dan & 4K/7K recommendations

## Purpose

Parse `.osu` charts from lazer storage, run Sunny Rework–style estimates, persist to the Sunny dan ratings store, expose them in the query language, and power 4K and 7K smart recommendations (Push / Accuracy / Consistency / Deficit / Skillset).

## Business rules

1. Estimates live in the Sunny dan ratings store (`beatmap_dan_ratings`); recommendations degrade without backfill.
2. Backfill is a Settings-started background job. Recommend HTTP handlers do not run Sunny backfill on the request path.
3. Recommendations and skill estimates are for a single mania keymode (`keyCount`, default 7). 4K and 7K pools are never mixed.
4. Matching uses Sunny stars for both 4K and 7K. Daniel remains a 4K profile / query-language label.

## Important symbols

- `packages/sunny-dan`
- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/analytics/recommend/*`
- `GET /api/practice/recommend` — optional `keyCount` (default 7)

## Dependencies

- `features/mastery-settings/` — job controls
- `features/practice-library/` — `dan:` / `sunny:` query language fields
- `packages/osu-chart`

## Depended on by

- `features/sessions/` — 4K/7K suggest
- `features/practice-profiles/` — mania estimates
- `features/map-marathon/` — fill track list from 4K/7K recommend

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Sunny dan ratings store
- [flows/sunny-backfill-to-recommend.md](../../flows/sunny-backfill-to-recommend.md)
