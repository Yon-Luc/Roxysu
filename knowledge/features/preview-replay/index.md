---
last_verified: 2026-08
confidence: inferred
touches:
  - apps/server/public/components/BeatmapPreviewModal.tsx
  - apps/server/public/components/ScoreReplayModal.tsx
  - apps/server/public/components/StdPlayfield.tsx
  - apps/server/public/lib/stdSkin.ts
  - apps/server/public/features/settings/sections/StandardSkinEditor.tsx
  - apps/server/src/routes/scores.ts
  - apps/server/src/replay/stdJudge.ts
  - apps/server/src/replay/loadStdChart.ts
  - packages/osu-chart/src/parseStd.ts
---

# Standard preview, rewatch, and playfield skin

## Purpose

Support **standard** (`osu`, game mode 0) beatmaps inside the existing preview and
score-rewatch suite (which originally covered **mania** only). When a standard
beatmap/score is selected, the UI renders an osu!-style playfield instead of a
mania notefield, and the score rewatch uses standard accuracy weights.

## Business meaning

Beatmap preview = listen + watch the chart play without judging input.
Score rewatch = replay a stored judgment timeline with the playing audio.
Standard playfield = the visual layer that draws circles, sliders, spinners, the
cursor trail, and judgment popups in osu! coordinates (512×384).

## Business rules

1. Standard accuracy weights are 300/100/50 on a 300 scale (perfect and great both
   300, good 100, ok and meh 50, miss 0). Mania weights stay 305/300/200/100/50 on
   a 305 scale.
   **Source:** `apps/server/src/replay/stdJudge.ts` (`stdAccuracyFromCounts*`) and
   `apps/server/public/components/ScoreReplayModal.tsx` (`STD_RESULT_WEIGHT`,
   `STD_ACC_SCALE`) — status: verified by `apps/server/src/replay/std.test.ts`.

2. **HR** (hard rock) flips the playfield and raises AR/OD, but does **not** shrink
   circle size. `adjustStdDifficulty` in `stdJudge.ts` keeps `cs` unchanged, matching
   real osu! behavior. AR adjust: HR `min(10, ar * 1.4)`, Easy `ar * 0.5`
   **Source:** `stdJudge.ts:adjustStdDifficulty`

3. Slider ticks are timing-accurate: spacing = `beatLength / SliderTickRate` at the
   local timing point; ticks are emitted per span (mirrored on repeats) with
   `{ frac, tMs }`; a tick landing exactly on the tail is dropped.
   **Source:** `parseStd.ts:computeSliderTicks`

4. Combo numbers advance for circles and slider heads only (spinners do not count).

5. Preview reverts to the default standard skin and passes raw (non-stacked) hit
   objects; rewatch passes HR-flipped, stacked objects with `hidden` set when HD is
   active.

6. The standard playfield skin is a separate store from the mania preview skin
   (`roxysu:std-skin` vs `roxysu:preview-skin`).

7. Hit circle / slider body size is scaled visually by `hitCircleScale` on the
   skin (default `0.9`, clamped 0.5–1.5). It only affects rendering — server-side
   judgment hit circles still use the real osu! radius from `circleSize`.
   **Source:** `StdPlayfield.tsx` (radius = `circleRadius(cs) * scale`),
   `lib/stdSkin.ts` — status: verified.

8. Slider and spinner bodies stay visible until `endMs` (plus a short linger). A
   head judgment must not despawn the track, ticks, or ball. Circles still hide
   shortly after their hit.
   **Source:** `StdPlayfield.tsx` visible-window `hideAfter` — status: inferred.

9. The standard skin editor loops a dense demo chart (overlapping circles, long
   sliders, spinner) at AR 6 so combo colors and slider elements stay on screen
   long enough to inspect.
   **Source:** `StandardSkinEditor.tsx` — status: inferred.

## Security rules

None — no access control on preview/replay/skin data beyond existing score owner
scope.

## Important states

- **Preview**: `frames`/`judgments` are hidden; animations (approach ring, slider
  ball) run from `getCurrentTimeMs()`.
- **Rewatch**: replay frames drive the cursor; judgments drive head/tick/tail flash,
  follow circle, combo numbers, and hit popups.
- **Hidden (HD)**: objects fade out across the final 40% of the preempt.

## Main flows

```text
Beatmap preview:
  user selects standard beatmap
    → fetchBeatmapPreview → /api/beatmaps/:id/preview → parseStdChart → hitObjects
    → based on ruleset, render StdPlayfield (skin from roxysu:std-skin)

Score rewatch:
  user selects standard score
    → fetchScoreReplay → /api/scores/:id/replay → loadStdChart + stdJudge
    → ScoreReplayModal computes accuracy with std weights
    → StdPlayfield draws frames + judgments + HD fade
```

## Implementation

- `StdPlayfield.tsx` — canvas renderer (combo numbers, slider ticks, follow circle,
  bouncing slider ball, tail flash, hit popups, HD fade, cursor+trail). Exports
  `StdHitObject`, `StdPlayfieldFrame`, `StdPlayfieldJudgment`, `StdReplayHitObjects`.
- `stdSkin.ts` — standard skin store: defaults, `useStdSkin`, `comboColorFor`.
- `StandardSkinEditor.tsx` — settings section with demo chart + color swatches +
  element toggles + reset.
- `stdJudge.ts` — standard judgments (head/tick/tail/spinner) and accuracy helpers.
- `scores.ts` / `beatmaps.ts` — standard preview + replay routes.

## Dependencies

- `packages/osu-chart` — `parseStdChart` provides hitObjects, ticks, timing points.
- `apps/server/src/replay/stdJudge.ts` — judgment computation.
- `lib/api.ts` — `fetchBeatmapPreview`, `fetchScoreReplay` typed payloads.

## Depended on by

- `apps/server/public/lib/stdSkin.ts` store is consumed by `StdPlayfield.tsx`,
  `ScoreReplayModal.tsx`, `BeatmapPreviewModal.tsx`, and `StandardSkinEditor.tsx`.

## Related knowledge

- [vocabulary.md](../vocabulary.md)
- [features/index.md](index.md)