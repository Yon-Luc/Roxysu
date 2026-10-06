---
last_verified: 2026-10
confidence: verified
touches:
  - packages/sunny-dan
  - packages/mania-difficulty
  - packages/mania-pattern-analysis
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/map-analysis/computeDanVariants.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/map-analysis/computeReworkDan.ts
  - apps/server/src/map-analysis/reworkDanJob.ts
  - apps/server/src/analytics/recommend
  - apps/server/src/analytics/recommend/axisThresholds.ts
---

# Sunny dan & 4K/7K recommendations

## Purpose

Parse `.osu` charts from lazer storage, run Sunny Rework–style estimates, persist to the Sunny dan ratings store, expose them in the query language, and power 4K and 7K smart recommendations (Push / Accuracy / Consistency / Deficit / Skillset).

Three estimators write to the same store, keyed by `algorithm`: `sunny`, `daniel`, and `mania-difficulty` (rework dan). `pattern:` labels now come from the **dominant skill** algorithm instead of Interlude.

## Business rules

1. Estimates live in the Sunny dan ratings store (`beatmap_dan_ratings`); recommendations degrade without backfill.
2. Backfill is a Settings-started background job. Practice/search list handlers and recommend HTTP handlers do not run Sunny/Daniel/rework/pattern compute on the request path.
3. Recommendations and skill estimates are for a single mania keymode (`keyCount`, default 7). 4K and 7K pools are never mixed.
4. Matching uses Sunny stars for both 4K and 7K. Daniel remains a 4K profile label (Alpha+ only; below/above band → `< …` / `> …` sentinels). `dan:` matches Sunny tiers and Daniel tiers; `daniel:` matches Daniel labels only. A Daniel row does not hide 4K Sunny tiers (Intro / Reform / LN) — primary display falls back to Sunny when Daniel is out of band (`primaryDanLabel`).
5. Modded plays (speed rate ≠ 1.0 or full-LN Invert) are rated by the **dan difficulty variants** store (`beatmap_dan_rating_variants`), computed lazily per played combo by an import-triggered background job. Skill axes and band plays read variant stars for modded plays; modded plays without a computed variant are excluded from skill until rated. NM-equivalent plays (rate 1.0, no Invert; Mirror/Classic ignored) always read the base store. Rework dan has **no** variant rows.
6. Both Sunny estimators honor pattern conversions: Daniel applies Invert/Hold Off
   via the same `OsuFileParser.modIN()` / `modHO()` conversions as Sunny
   (`calculateDaniel(..., { cvtFlag })`). Single-map read paths (beatmap
   preview dan chip, tosu live analysis) may compute estimates on request —
   ephemeral, never persisted; list/recommend handlers still never compute.
   The rework estimator applies chart conversion before parsing and supports
   playback rate only.
7. Rice / LN / FLN **map classification** for recommend, skill, stats mix, and
   `axis:` filters uses user settings (`recommend.ln_ratio_threshold` /
   `recommend.fln_ratio_threshold`, defaults 0.2 / 0.8). Sunny dan **label
   table** selection (RC vs LN) stays at the fixed package constant 0.2 —
   classification settings do not recompute labels. Rework dan label selection
   uses the same fixed 0.2 constant.
   **Enforced by:** `readAxisThresholdsSync` / `classifyMapAxis` in
   `apps/server/src/analytics/recommend/axisThresholds.ts` + `axis.ts`.

## Rework dan rules

1. Floors live in `packages/mania-difficulty/dans.json`. `bands` lists the band
   suffixes; each `tables["<keys>"].rice` / `.ln` entry is `{ name, floor, ceiling? }`.
   Only the last tier may set `ceiling`. Floors must strictly increase.
2. The file is validated at import time — an invalid config throws at boot
   rather than mislabelling. `validateDanConfig()` is covered by unit tests.
3. An empty `ln` array falls back to that key count's `rice` tiers. 7K declares
   no `ln` rows, so 7K LN currently resolves on the rice floors.
4. Key counts with no table (6K) return `Unknown difficulty` while still storing
   a star rating and skill breakdown.
5. Below the first floor is a `<` sentinel, above the last ceiling a `>`
   sentinel — same shape as Sunny, so `compileDanMatch` is reused unchanged.
6. Editing `dans.json` does **not** require re-estimation. `relabelReworkDanSync()`
   recomputes labels from stored stars; exposed as `POST /api/settings/rework-dan/relabel`
   and run automatically when the job starts with nothing missing.
7. `rework:` matches only `algorithm = 'mania-difficulty'` rows; `dan:` matches
   Sunny and Daniel only. The two never mix.

## Dominant skill rules

1. Active algorithm is `mania-skill-v1`; `PATTERN_ALGORITHM` points at it. Retired
   ids (`7k-heuristic-v1`, `7k-structural-v2`, `mania-interlude-v1`) throw on
   dispatch rather than silently returning Interlude results.
2. Labels are the five skills. Ties break by canonical order (speed, jack,
   coordination, technical, release).
3. Secondary skill is the runner-up only when it reaches `SECONDARY_SKILL_RATIO`
   (0.85) of the top skill.
4. `beatmap_pattern_analysis` density columns stay note-structural and are
   algorithm-independent. `sections` and `composition` are now time-binned skill
   peaks (`skillProfile()`, 2000 ms windows) instead of Interlude clusters.
5. Rows written under `mania-interlude-v1` stay in the table but are never joined.
   The Settings pattern job must be re-run to populate `mania-skill-v1`.
6. Retired Interlude query names still parse and map to the nearest skill
   (`normalizePatternValue`), so saved searches keep working.

## Important symbols

- `packages/sunny-dan`
- `packages/mania-difficulty` — port + `dans.json` + `skills.ts` + `skillProfile.ts`
- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/map-analysis/computeDanVariants.ts` — combo collection, backfill, variant lookups
- `apps/server/src/map-analysis/danVariantJob.ts` — post-import incremental job (also one-time recompute of pre-conversion Daniel variant rows, settings flag `dan_variants.daniel_cvt_recompute`)
- `apps/server/src/map-analysis/computeSunnyDan.ts:getSunnyDanForPatternMods` — mod-aware single-map reads
- `apps/server/src/map-analysis/reworkEstimator.ts:runReworkEstimatorFromText`
- `apps/server/src/map-analysis/computeReworkDan.ts` — persistence + `relabelReworkDanSync`
- `apps/server/src/map-analysis/reworkDanJob.ts` — Settings-started backfill
- `resolveDanVariant()` / `danVariantKey()` — `packages/mania-judge`
- `apps/server/src/analytics/recommend/*`
- `GET /api/practice/recommend` — optional `keyCount` (default 7)
- `GET /api/beatmaps/:id/sunny-dan?mods=&rate=` — mod-aware preview dan
- `GET|POST /api/settings/rework-dan{,/start,/stop,/relabel}`

## Dependencies

- `features/mastery-settings/` — job controls
- `features/practice-library/` — `dan:` / `sunny:` / `rework:` / `pattern:` query language fields
- `packages/osu-chart`
- `packages/mania-difficulty`

## Depended on by

- `features/sessions/` — 4K/7K suggest
- `features/practice-profiles/` — mania estimates
- `features/map-marathon/` — fill track list from 4K/7K recommend
- `features/hub/` — skill tags

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Sunny dan ratings store, Rework dan, Dominant skill, Mania difficulty port
- [flows/sunny-backfill-to-recommend.md](../../flows/sunny-backfill-to-recommend.md)