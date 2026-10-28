---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/mastery
  - apps/server/src/analytics/recommend/axisThresholds.ts
  - apps/server/src/analytics/recommend/focusSettings.ts
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/settings
  - apps/server/public/features/settings/JobsBatchChrome.tsx
  - apps/server/public/features/settings/JobsOnboardingModal.tsx
  - apps/server/public/features/settings/sections/RecommendFocusSection.tsx
  - packages/db/src/settings-keys.ts
  - apps/server/src/map-analysis/memoryPressure.ts
  - apps/server/src/map-analysis/patternAnalysisJob.ts
  - apps/server/src/map-analysis/reworkDanJob.ts
  - apps/server/src/map-analysis/calcBundle.ts
---

# Mastery & settings

## Purpose

Configure rating display preference (osu! stars / rework dan), paths, background jobs (rework + pattern backfills), Rice/LN/FLN classification boundaries, and recommendation focus bands (Push / Accuracy / Consistency / Deficit). Mastery levels use a fixed blend recomputed by the analytics pipeline (see [business/mastery-formulas.md](../../business/mastery-formulas.md)).

**In UI:** each Settings tab has chip-style jump links to its sections (`?tab=` + `?section=` — not `#` hashes, because the client uses hash history). Skin import, reset, and overlay sprite publish stay on the mania tab.

Rating display is stored in the browser (`roxysu:rating-display`) with modes
`osu` | `rework` only. Legacy stored prefs `dan` / `sunny` migrate to `rework`.
The `rework` option shows mania-difficulty-port dan labels via `reworkDanLabel`.
It needs the rework dan Settings job to have filled `beatmap_dan_ratings` rows,
and the list/detail UI must receive those fields — see
`features/rework-dan-recommendations/` rework display rules.

## Business rules

1. Path resolution precedence: env → Settings → platform default (`packages/osu-paths`).
2. Rice / LN / FLN **classification** boundaries are user-configurable (defaults LN start 20%, FLN start 80%). LN start must be strictly less than FLN start. Keys: `recommend.ln_ratio_threshold`, `recommend.fln_ratio_threshold`.
3. Classification thresholds affect recommend axes, skill estimates, stats skillset mix, and `axis:` query filters. They do **not** change Rework dan RC/LN **label table** selection (stays package constant 20%).
4. Recommendation **focus** settings (clear-rate bands, target difficulty, tolerance, topPlays) live in `recommend.focus_settings` and are edited on the Customize tab. Clear-rate band edges are clamped to 80–100% (Accuracy max may be open-ended above 100% in storage). Defaults keep Push in a closed 90–95% band near that skill level.
5. Each mastery row also stores Practice/QL play aggregates: `play_count`, `best_accuracy`, `best_pp`, `best_score`, `best_misses`, `last_played_at`. The query language joins these instead of aggregating `scores` per request, except `acc` / `misses` / `score` / `pp` conjoined with `mods` (see `features/practice-library/`). **Enforced by:** `runMasteryEngine` + `query-language/execute.ts` `baseFrom()`.

## Implementation

Settings UI is tab-grouped on `/settings`:

| Tab | Sections |
|---|---|
| Setup | osu!lazer data folder, live sync, in-game overlay, tosu / live map |
| Practice | score username, gamemode |
| Customize | Rice / LN / FLN boundaries, recommendation focuses |
| Appearance | appearance, difficulty display, preview skin, keybinds (columns + playback actions) |
| Jobs | Rework dan (mania difficulty port), dominant skill analysis, Mania Rating Lab |

Jobs pause themselves when the machine is low on memory (see
`memoryPressure.ts`) and resume automatically, so they are safe to leave running
unattended. The `paused` status reads "Paused — waiting for memory". The check
covers two ceilings, not one: free RAM *and* the V8 heap ratio, because a machine
with plenty of free RAM can still hit Node's heap cap, and that abort is fatal
rather than a pause. The panel's `memory` line shows both (RSS · free · heap
used/limit).

While a job runs, `JobsBatchChrome` shows a floating progress chip (and
completion toast) when the user leaves Settings — same pattern as Download
batch chrome. After the first meaningful sync, `JobsOnboardingModal` offers to
start Rework dan (pattern rows are filled in the same calculator pass). Accepting also
pulls a Hub calc bundle for the current app version when available.

Dominant skill analysis and rework dan rate one chart synchronously, so they
pause at a tighter heap ratio (`BACKFILL_IN_MAP_MAX_HEAP_RATIO`) than the other
jobs, and they re-check every 128 notes while the difficulty graph is built.
Hit-object and row methods are shared prototypes, not one closure set per note.
If a chart still crosses that ceiling, the graph is released, the map is stored
as a failed pattern row (and a failed rework row, when that job is the one
running), and the job pauses until the heap drops. That chart is not retried
until a recompute. A single on-request read does not use this abort.

Only the active tab’s panels mount. Jump chips and Command Palette deep-links both use `?section=<id>` (scroll + highlight via `useScrollToPageSection`); optional `?tab=` selects a tab when no section is present. Tab registry: `apps/server/public/features/settings/settingsTabs.ts`.

## Important symbols

- `apps/server/src/analytics/mastery/*`
- `apps/server/src/analytics/recommend/axisThresholds.ts` — read/validate thresholds
- `apps/server/src/routes/settings.ts`
- `apps/server/public/features/settings/*`
- `apps/server/public/features/settings/JobsBatchChrome.tsx`
- `apps/server/public/features/settings/JobsOnboardingModal.tsx`
- `apps/server/public/features/settings/sections/AxisThresholdsSection.tsx`
- `apps/server/public/features/settings/settingsTabs.ts`
- `packages/db/src/settings-keys.ts` — `RECOMMEND_LN_RATIO_THRESHOLD_KEY`, `RECOMMEND_FLN_RATIO_THRESHOLD_KEY`, `JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY`, `JOBS_ONBOARDING_COMPLETED_KEY`

## Dependencies

- `features/live-sync/` — practice library content for recompute

## Depended on by

- `features/practice-library/` — mastery filters; `axis:` filters use thresholds
- `features/practice-profiles/`
- `features/rework-dan-recommendations/` — backfill job from Settings; axis classification
- `features/sessions/` — 4K/7K recommend axes
- `features/stats/` — skillset mix / skill bands

## Related knowledge

- [business/mastery-formulas.md](../../business/mastery-formulas.md)
- [business/path-resolution.md](../../business/path-resolution.md)
- [architecture/client-theme.md](../../architecture/client-theme.md) — Appearance section
