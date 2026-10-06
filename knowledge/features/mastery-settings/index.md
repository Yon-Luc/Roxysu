---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/mastery
  - apps/server/src/analytics/recommend/axisThresholds.ts
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/settings
  - packages/db/src/settings-keys.ts
  - apps/server/src/map-analysis/memoryPressure.ts
  - apps/server/src/map-analysis/patternAnalysisJob.ts
  - apps/server/src/map-analysis/reworkDanJob.ts
---

# Mastery & settings

## Purpose

Choose mastery formula (`simple` or `practice`), rating display preference (osu! stars / dan / Sunny stars / rework dan), paths, background jobs (Sunny, Daniel, rework backfills), and Rice/LN/FLN classification boundaries. Recompute mastery across the practice library when formula changes.

Rating display is stored in the browser (`roxysu:rating-display`). The `rework`
option shows mania-difficulty-port dan labels (and the matching star under the
detail panel). It needs the rework dan Settings job to have filled
`beatmap_dan_ratings` rows, and the list/detail UI must receive those fields —
see `features/sunny-dan-recommendations/` rule 8.

## Business rules

1. Mastery formula is a setting; switching triggers recompute.
2. Path resolution precedence: env → Settings → platform default (`packages/osu-paths`).
3. Rice / LN / FLN **classification** boundaries are user-configurable (defaults LN start 20%, FLN start 80%). LN start must be strictly less than FLN start. Keys: `recommend.ln_ratio_threshold`, `recommend.fln_ratio_threshold`.
4. Classification thresholds affect recommend axes, skill estimates, stats skillset mix, and `axis:` query filters. They do **not** change Sunny dan RC/LN **label table** selection (stays package constant 20%).

## Implementation

Settings UI is tab-grouped on `/settings`:

| Tab | Sections |
|---|---|
| Setup | osu!lazer data folder, live sync, in-game overlay, tosu / live map |
| Practice | mastery formula, score username, gamemode |
| Customize | Rice / LN / FLN boundaries |
| Appearance | appearance, difficulty display, preview skin, keybinds (columns + playback actions) |
| Jobs | Sunny dan, Daniel dan, rework dan (mania difficulty port), dominant skill analysis, Mania Rating Lab |

Jobs pause themselves when the machine is low on memory (see
`memoryPressure.ts`) and resume automatically, so they are safe to leave running
unattended. The `paused` status reads "Paused — waiting for memory". The check
covers two ceilings, not one: free RAM *and* the V8 heap ratio, because a machine
with plenty of free RAM can still hit Node's heap cap, and that abort is fatal
rather than a pause. The panel's `memory` line shows both (RSS · free · heap
used/limit).

Dominant skill analysis and rework dan rate one chart synchronously, so they
pause at a tighter heap ratio (`BACKFILL_IN_MAP_MAX_HEAP_RATIO`) than the other
jobs, and they re-check every 128 notes while the difficulty graph is built.
Hit-object and row methods are shared prototypes, not one closure set per note.
If a chart still crosses that ceiling, the graph is released, the map is stored
as a failed pattern row (and a failed rework row, when that job is the one
running), and the job pauses until the heap drops. That chart is not retried
until a recompute. A single on-request read does not use this abort.

Only the active tab’s panels mount. Deep-links still use `?section=<id>` (Command Palette); optional `?tab=` selects a tab when no section is present. Tab registry: `apps/server/public/features/settings/settingsTabs.ts`.

## Important symbols

- `apps/server/src/analytics/mastery/*`
- `apps/server/src/analytics/recommend/axisThresholds.ts` — read/validate thresholds
- `apps/server/src/routes/settings.ts`
- `apps/server/public/features/settings/*`
- `apps/server/public/features/settings/sections/AxisThresholdsSection.tsx`
- `apps/server/public/features/settings/settingsTabs.ts`
- `packages/db/src/settings-keys.ts` — `RECOMMEND_LN_RATIO_THRESHOLD_KEY`, `RECOMMEND_FLN_RATIO_THRESHOLD_KEY`

## Dependencies

- `features/live-sync/` — practice library content for recompute

## Depended on by

- `features/practice-library/` — mastery filters; `axis:` filters use thresholds
- `features/practice-profiles/`
- `features/sunny-dan-recommendations/` — backfill job from Settings; axis classification
- `features/sessions/` — 4K/7K recommend axes
- `features/stats/` — skillset mix / skill bands

## Related knowledge

- [business/mastery-formulas.md](../../business/mastery-formulas.md)
- [business/path-resolution.md](../../business/path-resolution.md)
- [architecture/client-theme.md](../../architecture/client-theme.md) — Appearance section
