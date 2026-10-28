---
last_verified: 2026-10-28
confidence: verified
touches:
  - packages/mania-difficulty
  - packages/mania-pattern-analysis
  - apps/server/src/map-analysis/memoryPressure.ts
  - apps/server/src/map-analysis/jobYield.ts
  - apps/server/src/map-analysis/patternAnalysisJob.ts
  - apps/server/src/map-analysis/computePatternAnalysis.ts
  - apps/server/src/map-analysis/calcBundle.ts
  - apps/server/src/map-analysis/calcBundleFile.ts
  - apps/desktop/main.js
  - apps/server/src/map-analysis/reworkDanJob.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/src/map-analysis/computeDanVariants.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/analytics/playerStatsCache.ts
  - apps/server/src/routes/settings.ts
  - apps/server/src/map-analysis/computeReworkDan.ts
  - apps/server/src/routes/practice.ts
  - apps/server/src/routes/beatmaps.ts
  - apps/server/public/lib/ratingDisplay.ts
  - apps/server/src/tosu/analyze.ts
  - apps/server/src/tosu/types.ts
  - apps/server/src/analytics/recommend
  - apps/server/src/analytics/recommend/axisThresholds.ts
  - apps/server/src/analytics/recommend/focusSettings.ts
  - apps/server/public/features/settings/sections/RecommendFocusSection.tsx
---

# Rework dan & 4K/7K recommendations

## Purpose

Parse `.osu` charts from lazer storage, run the mania difficulty port (rework dan), persist to the Dan ratings store, expose them in the query language, and power 4K and 7K smart recommendations (Push / Accuracy / Consistency / Deficit / Skillset).

Product writes use `algorithm = 'mania-difficulty'` (rework dan). Legacy Sunny/Daniel estimator rows are deleted by migration `0031_drop_sunny_daniel_ratings` and are not computed, backfilled, or queried. `pattern:` matches either the **dominant skill** or the **chart shape**, both written by algorithm `mania-skill-v1`.

## Business rules

1. Estimates live in the Dan ratings store (`beatmap_dan_ratings`); recommendations degrade without rework backfill.
2. Rework (and pattern) backfill is a Settings-started background job (also offered after first sync via the Jobs onboarding modal). Before backfill, a packaged boot applies the **Calc bundle file** shipped with that release (never the Hub); a dev boot gap-fills from a **Hub calc bundle** matching the Roxysu product version. Practice/search list handlers and recommend HTTP handlers do not run rework/pattern compute on the request path.
3. Recommendations and skill estimates are for a single mania keymode (`keyCount`, default 7). 4K and 7K pools are never mixed.
4. Product query language and rating display are rework-only: `dan:` aliases `rework:` (mania-difficulty labels via `expandReworkDanMatch`). Rating modes are `osu` | `rework`; legacy `dan`/`sunny` prefs migrate to `rework`. `formatSkillRating` uses `reworkDanLabel`.
5. Modded plays (speed rate ≠ 1.0 or full-LN Invert) are rated by the **dan difficulty variants** store (`beatmap_dan_rating_variants`), computed for `mania-difficulty` only by an import-triggered background job. Skill axes and band plays read variant stars for modded plays; modded plays without a computed variant are excluded from skill until rated. NM-equivalent plays (rate 1.0, no Invert; Mirror/Classic ignored) always read the base rework row. Recommend / skill / stats analytics join `algorithm = 'mania-difficulty'` only (`needsReworkBackfill`, `reworkStar` / `reworkEstDiff`).
6. The rework estimator applies chart conversion (Invert) before parsing and
   supports playback rate. Tosu live analysis may compute rework ephemerally
   on request (never persisted); list/recommend handlers still never compute.
7. Rice / LN / FLN **map classification** for recommend, skill, stats mix, and
   `axis:` filters uses user settings (`recommend.ln_ratio_threshold` /
   `recommend.fln_ratio_threshold`, defaults 0.2 / 0.8). Rework dan **label
   table** selection (RC vs LN) stays at the fixed package constant 0.2 —
   classification settings do not recompute labels.
   **Enforced by:** `readAxisThresholdsSync` / `classifyMapAxis` in
   `apps/server/src/analytics/recommend/axisThresholds.ts` + `axis.ts`.
8. Push / Accuracy / Consistency / Deficit **focus definitions** (clear-rate
   bands, target difficulty ratio, tolerance, topPlays) are user settings
   (`recommend.focus_settings`, Customize tab). Defaults: Push closed
   90–95% band targeting 100% ±8% of that band’s skill; Accuracy 99%+;
   Consistency 96–99%; Deficit at weak-axis comfort skill ±10%.
   **Enforced by:** `readFocusSettingsSync` / `estimateSevenKSkillFromPlays` /
   `recommendPush|Accuracy|Consistency|Deficit` in
   `apps/server/src/analytics/recommend/focusSettings.ts` + `sevenKSkill.ts` +
   `strategies.ts`.
   Changing either setting (`PATCH /api/settings`) also drops the player stats
   cache (`invalidatePlayerStatsCache()` in `routes/settings.ts`) so the next
   Stats view reflects the new bands.

## Rework dan rules

1. Floors live in `packages/mania-difficulty/dans.json`. Each
   `tables["<keys>"].rice` / `.ln` entry is `{ name, id?, floor, ceiling? }`.
   A tier spans its floor to the next floor and is labelled with its bare
   `name` — no `low` / `mid` / `high` suffix. The `--` / `++` rows are the
   split. Only the last tier may set `ceiling`. Floors must strictly increase.
2. `id` (optional) is the base tier a sub-level belongs to — the "Regular 7" /
   "Regular 7+" / "Regular 7++" rows all carry `id: "Regular 7"` so UIs can group
   them. It must name a tier of the same table and stay contiguous; it defaults
   to the row's own `name`. `validateDanConfig()` enforces both rules.
3. A last tier **without** `ceiling` is an open-ended sentinel: it covers
   `[floor, ∞)` in one interval labelled with the bare name (4K `>θ`, 4K LN
   `LN >18`, 7K `Regular >∞`).
4. The file is validated at import time — an invalid config throws at boot
   rather than mislabelling. `validateDanConfig()` is covered by unit tests.
5. An empty `ln` array falls back to that key count's `rice` tiers. 7K declares
   no `ln` rows, so 7K LN currently resolves on the rice floors.
6. Key counts with no table (6K) return `Unknown difficulty` while still storing
   a star rating and skill breakdown.
7. Below the first floor is a `< {name}` sentinel; once past the table, labels
   come from the last tier — an explicit `ceiling` yields a `> {name}` sentinel
   (same shape as legacy dan label matching, so `compileDanMatch` is reused
   unchanged), an open-ended last tier yields the bare tier name.
8. Aliases make tiers searchable beyond their literal label: a tier row may
   declare `aliases` — on a base row an alias covers its whole group
   (`rework:Gamma`, `rework:γ` and `rework:Regular Gamma` all match every
   `Regular γ*` label on both key modes). `expandReworkDanMatch()` resolves a
   token to concrete tier names; `dan:` and `rework:` both use it and fall back
   to generic label-token matching for sentinel lookups and unresolved values.
   Legacy `sunny:`, `daniel:`, `danstars`, and `sunnystars` fields are removed.
9. Editing `dans.json` does **not** require re-estimation. `relabelReworkDanSync()`
   recomputes labels from stored stars on the Dan ratings store and on dan
   difficulty variants; exposed as `POST /api/settings/rework-dan/relabel`,
   run when the job starts with nothing missing, and run after the boot
   calc-bundle apply (`relabelStoredReworkDans`) so a shipped bundle's old
   band suffixes do not stick. Stars stay the bundle's.
10. `dan:` and `rework:` both match only `algorithm = 'mania-difficulty'` rows
   (`dr_r`). `axis:` uses rework `ln_ratio`.
11. The mania difficulty port pin is `packages/mania-difficulty/upstream/revision.json`
   (`loleur362/osu` branch `mania-difficulty`, currently `1f2cc08`, folded SS accuracy factors in coordination and release; skill
   curves use 100% accuracy as the base difficulty). A new pin changes star ratings.
   **Calculate missing dans** only fills missing rows and rows whose beatmap
   hash changed. **Recalculate all** (`POST /api/settings/rework-dan/recompute`)
   deletes `mania-difficulty` dan rows and `mania-skill-v1` pattern rows, then
   starts the same backfill. It refuses while a pass is running, stopping, or
   paused. On a packaged install, a product-version bump with a usable shipped
   **Calc bundle file** replaces `mania-difficulty` / `mania-skill-v1` rows the
   file contains, **drops** bundle-algorithm rows whose hash it does not
   contain (`dropCalcBundleLeftovers`), publishes `calc-bundle.applied`
   (client invalidates `["beatmap"]` / `["practice"]`), and — when rows were
   dropped — the entry points start the missing-only backfill, so every stored
   rating ends up on the new formula. A missing or version-mismatched file
   still marks applied and keeps previous-version rows (no Hub fallback).
   `bun desktop` does not set `ROXYSU_PACKAGED`, so it gap-fills only from the
   Hub and neither replaces nor drops. A Hub bundle or manual pull always stays
   gap-fill: old successful rows are never removed by them.
12. Chart shape is counted on the difficulty row graph in the same calculator pass as the dominant skill (`chartShapeWalk` before the graph is released). It does not change star rating. Families are keymode-scoped per `shapesForKeyCount` (osu! wiki pattern terms): jumpstream and handstream are 4K only, bracket is non-4K only, and outside 4K chordstream requires 3+ note chords (a 7K double beside a single stays unlabeled). Stream, trill, jumptrill, chordjack, anchor, shield, and tech exist on every key count. Anchor and shield are parallel counts (they do not steal a row from jumpstream or chordjack) and are promoted to `shape_pattern` only when they clear their bar; the walk winner is stored as `secondary_shape`. Tech is the residual mix (several families, none leading). A one-column jack run is an anchor. Stored on `shape_pattern` / `secondary_shape`. A pattern job start and a calc-bundle apply run `nullIllegalShapeLabels` first, so stale cross-keymode labels (e.g. 7K jumpstream) are nulled and refilled by the missing-shape path — without a new algorithm id. That sweep does not rewrite a still-legal chordjack into anchor; a pattern recompute does. A pattern row with a skill and a null shape is missing and is filled by the pattern job. An empty `shape_pattern` means the walk ran and no family led, so the job does not recompute it. The map page, Now selected, overlay, and tosu live show `shape_pattern` (and its note shares), not the dominant skill; the weights panel and pattern browser list only families valid for the chart's key count.
13. The `rework` rating display mode is client-side (`roxysu:rating-display`).
   Practice/search/collection list cards and the beatmap detail panel must pass
   `reworkStar` / `reworkEstDiff` / `reworkLnRatio` into `formatPrimaryRating`
   and `primaryDanSource`. The practice list serializer (`mapCard`) and
   collection/search item maps must include those fields — dropping them makes
   the mode fall back to osu stars even after a successful backfill. Detail
   reads `getReworkDan` (persisted only; no on-request compute). **tosu live**
   analysis computes an ephemeral rework estimate (`analysis.rework`, rate via
   `clockRate` only) so Current session **Now selected** and the `/now-selected`
   page show Rework dan when that display mode is selected.

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
4. **Skills store per-note base difficulty in a `Float64Array`.** Processor
   skills (speed, technical, jack, coordination, release) share one accuracy
   multiplier row. The Total skill's combined curve changes on every note, so
   those rows live in a second flat buffer. Do not reintroduce per-note
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
      own. Wired into the rework and pattern jobs; both check between maps via
      `shouldContinue`. The dan variant job pauses the same way (status
      `paused`, 5 s poll) and also checks before every combo (rule 14). A backfill must never be the process that pushes a
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
14. **The dan variant job is memory-aware, yields per combo, and does not re-scan on a null delta.**
    - `backfillDanVariants` (async) checks `shouldContinue` (`isMemoryPressure`) before each combo and yields the event loop after each (`yieldForBackfill`). The job drops only combos that ran when a batch stops early, then pauses and resumes on its own. `backfillDanVariantsSync` remains for tests and one-shot callers.
    - An import with `changed_score_ids = null` means "unknown delta", not "every score". The job runs the unrestricted `collectDanVariantCombos` for it only when the mania score fingerprint (count, newest play, total mods length) differs from the one the last full scan read; the boot scan records that fingerprint. Non-null deltas stay restricted to the listed score ids.
    - When a run wrote variant rows (`computedThisRun > 0`), `finish()` calls `invalidatePlayerStatsCache()`: the stats cache ignores `dashboard.updated`, and skill axes drop modded plays until their variant exists.
    - Covered by `danVariantJob.test.ts`.

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

- `packages/mania-difficulty` — port + `dans.json` + `skills.ts` + `skillProfile.ts`
- `apps/server/src/map-analysis/memoryPressure.ts` — OS headroom **and** V8 heap ratio; `BACKFILL_MIN_HEADROOM_MB`, `BACKFILL_MAX_HEAP_RATIO`
- `apps/server/src/map-analysis/jobYield.ts` — per-map yield + forced collection (`Bun.gc`, else `global.gc`)
- `packages/mania-pattern-analysis/src/analyze.ts:analyzeManiaBackfillFromOsuText` — chart-level only, no timeline
- `apps/server/src/map-analysis/computePatternAnalysis.ts:backfillPatternAnalysis` — async, yields per map, honours `shouldContinue`
- `apps/server/src/map-analysis/computeDanVariants.ts` — combo collection, backfill, variant lookups
- `apps/server/src/map-analysis/danVariantJob.ts` — post-import incremental job (memory-guarded, per-combo yield; invalidates the player stats cache after writing rows)
- `apps/server/src/map-analysis/reworkEstimator.ts:analyzeManiaOnceFromText` — single pass, both stores
- `apps/server/src/map-analysis/reworkEstimator.ts:runReworkEstimatorFromText` — dan only, no profile
- `apps/server/src/map-analysis/computeReworkDan.ts` — persistence + `relabelReworkDanSync`
- `apps/server/src/map-analysis/reworkDanJob.ts` — Settings-started backfill; `relabelStoredReworkDans` after boot calc-bundle apply
- `resolveDanVariant()` / `danVariantKey()` — `packages/mania-judge`
- `apps/server/src/analytics/recommend/*`
- `GET /api/practice/recommend` — optional `keyCount` (default 7)
- `GET|POST /api/settings/rework-dan{,/start,/stop,/relabel,/recompute}`

## Dependencies

- `features/mastery-settings/` — job controls, Jobs chrome, first-sync onboarding
- `features/hub/` — calc bundle (release file boot apply; Hub pull for dev) before local backfill
- `features/practice-library/` — `dan:` / `rework:` / `pattern:` query language fields
- `packages/osu-chart`
- `packages/mania-difficulty`

## Depended on by

- `features/sessions/` — 4K/7K suggest
- `features/practice-profiles/` — mania estimates
- `features/map-marathon/` — fill track list from 4K/7K recommend
- `features/hub/` — skill tags

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Dan ratings store, Rework dan, Dominant skill, Mania difficulty port, Hub calc bundle
- [flows/rework-backfill-to-recommend.md](../../flows/rework-backfill-to-recommend.md)
- [flows/hub-calc-bundle-pull.md](../../flows/hub-calc-bundle-pull.md)
- [decisions/hub-calc-bundle-version.md](../../decisions/hub-calc-bundle-version.md)
