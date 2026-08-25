---
last_verified: 2026-08
confidence: verified
touches:
  - packages/sunny-dan
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/map-analysis/computeDanVariants.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/analytics/recommend
---

# Sunny dan & 4K/7K recommendations

## Purpose

Parse `.osu` charts from lazer storage, run Sunny Rework–style estimates, persist to the Sunny dan ratings store, expose them in the query language, and power 4K and 7K smart recommendations (Push / Accuracy / Consistency / Deficit / Skillset).

## Business rules

1. Estimates live in the Sunny dan ratings store (`beatmap_dan_ratings`); recommendations degrade without backfill.
2. Backfill is a Settings-started background job. Practice/search list handlers and recommend HTTP handlers do not run Sunny/Daniel/pattern compute on the request path.
3. Recommendations and skill estimates are for a single mania keymode (`keyCount`, default 7). 4K and 7K pools are never mixed.
4. Matching uses Sunny stars for both 4K and 7K. Daniel remains a 4K profile / query-language label.
5. Modded plays (speed rate ≠ 1.0 or full-LN Invert) are rated by the **dan difficulty variants** store (`beatmap_dan_rating_variants`), computed lazily per played combo by an import-triggered background job. Skill axes and band plays read variant stars for modded plays; modded plays without a computed variant are excluded from skill until rated. NM-equivalent plays (rate 1.0, no Invert; Mirror/Classic ignored) always read the base store.
6. Both estimators honor pattern conversions: Daniel applies Invert/Hold Off
   via the same `OsuFileParser.modIN()` / `modHO()` conversions as Sunny
   (`calculateDaniel(..., { cvtFlag })`). Single-map read paths (beatmap
   preview dan chip, tosu live analysis) may compute estimates on request —
   ephemeral, never persisted; list/recommend handlers still never compute.

## Important symbols

- `packages/sunny-dan`
- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/map-analysis/computeDanVariants.ts` — combo collection, backfill, variant lookups
- `apps/server/src/map-analysis/danVariantJob.ts` — post-import incremental job (also one-time recompute of pre-conversion Daniel variant rows, settings flag `dan_variants.daniel_cvt_recompute`)
- `apps/server/src/map-analysis/computeSunnyDan.ts:getSunnyDanForPatternMods` — mod-aware single-map reads
- `resolveDanVariant()` / `danVariantKey()` — `packages/mania-judge`
- `apps/server/src/analytics/recommend/*`
- `GET /api/practice/recommend` — optional `keyCount` (default 7)
- `GET /api/beatmaps/:id/sunny-dan?mods=&rate=` — mod-aware preview dan

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
