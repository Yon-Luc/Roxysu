---
last_verified: 2026-10
confidence: verified
touches:
  - packages/sunny-dan
  - packages/mania-difficulty
  - packages/mania-pattern-analysis
  - apps/server/src/map-analysis/memoryPressure.ts
  - apps/server/src/map-analysis/jobYield.ts
  - apps/server/src/map-analysis/patternAnalysisJob.ts
  - apps/server/src/map-analysis/computePatternAnalysis.ts
  - apps/desktop/main.js
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/map-analysis/computeDanVariants.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/map-analysis/computeReworkDan.ts
  - apps/server/src/map-analysis/reworkDanJob.ts
  - apps/server/src/routes/practice.ts
  - apps/server/src/routes/beatmaps.ts
  - apps/server/public/lib/ratingDisplay.ts
  - apps/server/src/tosu/analyze.ts
  - apps/server/src/tosu/types.ts
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
8. The `rework` rating display mode is client-side (`roxysu:rating-display`).
   Practice/search/collection list cards and the beatmap detail panel must pass
   `reworkStar` / `reworkEstDiff` / `reworkLnRatio` into `formatPrimaryRating`
   and `primaryDanSource`. The practice list serializer (`mapCard`) and
   collection/search item maps must include those fields — dropping them makes
   the mode fall back to osu stars even after a successful backfill. Detail
   reads `getReworkDan` (persisted only; no on-request compute). **tosu live**
   analysis computes an ephemeral rework estimate (`analysis.rework`, rate via
   `clockRate` only) so Current session **Now selected** and the `/now-selected`
   page show Rework dan when that display mode is selected — not Sunny dan.

## Performance rules

1. **One calculator pass fills both stores.** The dan row and the dominant-skill
   row need the same skill values, so `analyzeManiaOnceFromText()` parses the
   chart once and writes `beatmap_dan_ratings` + `beatmap_pattern_analysis`
   together. The rework dan job does this by default
   (`computeReworkDanSync(..., { withPattern: true })`). Never add a second
   `analyzeManiaSkillNotes` call to a dan code path — that re-parses and re-runs
   the whole calculator.
2. **Dan-only callers skip the skill profile.** Omitting `windowMs` skips
   per-note snapshots and window binning, so preview/live reads stay cheap.
3. **Star ratings must not depend on the profile.** A single pass with
   `withPattern` produces the identical star as a dan-only pass — asserted in
   `computeReworkDan.integration.test.ts`.
4. **Skills store per-note base difficulty in a `Float64Array`.** Accuracy
   multipliers are constant per skill. Do not reintroduce per-note
   `AccuracyDifficulties` objects: the root-finder scans every note ~25 times
   per skill, so that allocation was the dominant cost.
5. **Preprocessor walks return scalars.** `walkChain` returns a `ChainStats`
   (length/rowCount/noteCount plus bounds). Do not rebuild `ManiaChain` row
   arrays in the preprocessor — every detector calls it per row.
6. **Backfill stops on `attempted === 0`.** `backfillReworkDanSync` no longer
   recounts the library every batch (`remaining` is `null` unless asked). One
   SQLite transaction covers a batch.
7. Parity is enforced by `tests/parity/baselines.test.ts` against pinned C#
   baselines. Any optimization must keep SR and skill values within tolerance.
8. **Memory: never size an allocation by chart duration without a cap.** The
   skill profile bins one entry per `windowMs` across the chart, so a chart with
   a malformed final note timestamp (editor junk, corrupt file) produced ~1M
   windows and ~1 GB from a single map. This crashed a full-library backfill with
   an OOM kill.
   - `MAX_SKILL_WINDOWS` (3600) caps `skillProfile` binning.
   - `MAX_DENSITY_SAMPLES` (7200) caps the preview density timeline.
   - **Backfills must not bin at all — and must say so explicitly.** They persist
     only dominant/secondary/confidence and the densities, so pass
     `windowMs: null` (`skillProfile`, `analyzeManiaOnceFromText`). For
     `analyzeManiaSkillNotes` an omitted argument bins rather than skipping, so
     the backfill path uses `analyzeManiaBackfillFromOsuText()` (rule 13). Only
     the preview/detail surface sets a width, because it renders the timeline.
9. **A note graph is one large object cycle.** `releaseHitObjectGraph()` severs
   the cross-links after evaluation so a finished map is collectable
   immediately. Call it once no further evaluation will read the graph.
10. Backfill loops yield after every map (`jobYield.ts`), forcing a collection
    every 16 maps. Measured peak RSS is flat across a 600-map run; without the
    yield the curve rises until a cycle-collection pass catches up.
11. **Every backfill job is memory-aware, against two ceilings.** `memoryPressure.ts`
    reads `MemAvailable` + `SwapFree` from `/proc/meminfo` **and** the V8 heap
    (`node:v8` `getHeapStatistics()`). Either condition pauses the job.
    - Free RAM below `BACKFILL_MIN_HEADROOM_MB` (512 MB), or
    - `used_heap_size / heap_size_limit` above `BACKFILL_MAX_HEAP_RATIO` (0.65).
    - The heap check exists because **a V8 heap abort is fatal and
      uncatchable**, and free RAM can look healthy while Node has exhausted its
      own ~4 GB cap (observed: the desktop server died with
      `FATAL ERROR: Ineffective mark-compacts near heap limit`, exit 134, after
      ~57 min of rework + pattern work). Do not raise
      `--max-old-space-size` to "fix" this — it only moves the crash and can
      hand the machine to the kernel OOM killer.
    - Paused jobs set status `paused` and re-check every 5 s, resuming on their
      own. Wired into the rework, Sunny, Daniel and pattern jobs; the rework and
      pattern jobs check between maps via `shouldContinue`, the Sunny/Daniel
      jobs between batches. A backfill must never be the process that pushes a
      busy desktop into swap exhaustion — the OOM killer then takes arbitrary
      processes (observed: it killed the terminal, not the server). The Settings
      job panel shows `memory` (RSS · free · heap used/limit) and
      `minHeadroomMb`.
12. **A backfill loop must yield per map, on both runtimes.** `jobYield.ts` calls
    `Bun.gc` when present and falls back to `global.gc`, which Node only exposes
    under `--expose-gc`. The desktop shell therefore sets
    `NODE_OPTIONS=--expose-gc` on the **server child only** (Electron must not
    inherit it), which also reaches dev `tsx` — `spawnNodeEntry` drops
    positional node args when it launches through `tsx`. Without a collector the
    loop still yields, but note graphs wait for V8 to choose to collect them.
    `backfillPatternAnalysis` is async and yields per map for this reason; it was
    previously a tight 40-map synchronous batch.
13. **Backfills must pass `windowMs: null`, never omit it.**
    `analyzeManiaSkillNotes(notes, keys, od, windowMs?)` treats an **omitted**
    width as "use the default", so it bins; only an explicit `null` skips
    binning. Omitting it is what made the pattern backfill allocate a timeline it
    discards. `analyzeManiaBackfillFromOsuText()` wraps the correct call — use it
    for backfills and `analyzeManiaFromOsuText` only for the on-request
    timeline. Request-path fills (`computeOnePattern`) stay on the binning call
    because they never run in bulk. Covered by
    `computePatternAnalysis.integration.test.ts`.

Benchmarks: `packages/mania-difficulty` `bun run bench` (per-phase calculator),
`apps/server` `bun run bench:rework` (end-to-end backfill over a synthetic
library) and `bun run bench:mem` (RSS growth per map; `BENCH_MODE=sync` shows the
old non-yielding loop).

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
   peaks (`skillProfile()`, `DEFAULT_SKILL_WINDOW_MS` = 2000 ms) instead of
   Interlude clusters.
5. Rows written under `mania-interlude-v1` stay in the table but are never joined.
   The Settings pattern job must be re-run to populate `mania-skill-v1` — though
   the rework dan job now fills both stores in one pass, so it usually covers it.
6. Retired Interlude query names still parse and map to the nearest skill
   (`normalizePatternValue`), so saved searches keep working.

## Important symbols

- `packages/sunny-dan`
- `packages/mania-difficulty` — port + `dans.json` + `skills.ts` + `skillProfile.ts`
- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/map-analysis/memoryPressure.ts` — OS headroom **and** V8 heap ratio; `BACKFILL_MIN_HEADROOM_MB`, `BACKFILL_MAX_HEAP_RATIO`
- `apps/server/src/map-analysis/jobYield.ts` — per-map yield + forced collection (`Bun.gc`, else `global.gc`)
- `packages/mania-pattern-analysis/src/analyze.ts:analyzeManiaBackfillFromOsuText` — chart-level only, no timeline
- `apps/server/src/map-analysis/computePatternAnalysis.ts:backfillPatternAnalysis` — async, yields per map, honours `shouldContinue`
- `apps/server/src/map-analysis/computeDanVariants.ts` — combo collection, backfill, variant lookups
- `apps/server/src/map-analysis/danVariantJob.ts` — post-import incremental job (also one-time recompute of pre-conversion Daniel variant rows, settings flag `dan_variants.daniel_cvt_recompute`)
- `apps/server/src/map-analysis/computeSunnyDan.ts:getSunnyDanForPatternMods` — mod-aware single-map reads
- `apps/server/src/map-analysis/reworkEstimator.ts:analyzeManiaOnceFromText` — single pass, both stores
- `apps/server/src/map-analysis/reworkEstimator.ts:runReworkEstimatorFromText` — dan only, no profile
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