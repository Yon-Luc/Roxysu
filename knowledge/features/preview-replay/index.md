---
last_verified: 2026-08
confidence: inferred
touches:
  - apps/server/public/components/BeatmapPreviewModal.tsx
  - apps/server/public/components/BeatmapPreviewButton.tsx
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
  - apps/server/public/features/now-selected/NowSelectedPage.tsx
  - apps/server/public/features/overlay/OverlayElements.tsx
  - apps/server/public/components/ScoreReplayModal.tsx
  - apps/server/public/lib/api.ts
  - apps/server/src/routes/beatmaps.ts
  - apps/server/src/routes/scores.ts
  - apps/server/public/components/StdPlayfield.tsx
  - apps/server/public/lib/paintStdPlayfield.ts
  - apps/server/public/components/TaikoPlayfield.tsx
  - apps/server/public/lib/paintTaikoPlayfield.ts
  - apps/server/public/components/CatchPlayfield.tsx
  - apps/server/public/lib/paintCatchPlayfield.ts
  - apps/server/public/components/ManiaNotefield.tsx
  - apps/server/public/lib/playfieldRaf.ts
  - apps/server/public/lib/paintManiaNotefield.ts
  - apps/server/public/lib/previewSkin.ts
  - apps/server/public/lib/osuSkinIni.ts
  - apps/server/public/lib/maniaSkinImport.ts
  - apps/server/public/components/ManiaSkinImportModal.tsx
  - apps/server/public/components/ManiaSkinDropHost.tsx
  - apps/server/public/lib/api.ts
  - apps/server/public/lib/stdSkin.ts
  - apps/server/public/lib/taikoSkin.ts
  - apps/server/public/lib/catchSkin.ts
  - apps/server/public/features/settings/SkinColorInput.tsx
  - apps/server/public/features/settings/sections/StandardSkinEditor.tsx
  - apps/server/public/features/settings/sections/TaikoSkinEditor.tsx
  - apps/server/public/features/settings/sections/CatchSkinEditor.tsx
  - apps/server/src/routes/scores.ts
  - apps/server/src/replay/stdJudge.ts
  - apps/server/src/replay/taikoJudge.ts
  - apps/server/src/replay/catchJudge.ts
  - apps/server/src/replay/loadStdChart.ts
  - apps/server/src/replay/loadTaikoChart.ts
  - apps/server/src/replay/loadCatchChart.ts
  - packages/osu-chart/src/parseStd.ts
  - packages/osu-chart/src/parseTaiko.ts
  - packages/osu-chart/src/parseCatch.ts
  - packages/osu-chart/src/osuFileParser.js
---

# Preview, rewatch, and playfield skins

## Purpose

Support **mania**, **standard** (`osu`), **taiko**, and **catch** (`fruits`)
inside beatmap preview and score rewatch. Each ruleset has its own parser, judge,
paint module, and localStorage skin.

## Business meaning

Beatmap preview = listen + watch the chart play without judging input.
Score rewatch = replay a stored judgment timeline with the playing audio.
Playfield = the visual layer for that ruleset (notefield, 512×384, or taiko lane).

## Business rules

1. Accuracy weights are per-ruleset. Mania: 305/300/200/100/50 on a 305 scale.
   Standard: 300/100/50 on a 300 scale. Taiko: Great 300, Ok 150, Miss 0.
   Catch: fruit 300, droplet/banana 100 (caught), miss 0.
   **Source:** `stdJudge.ts`, `taikoJudge.ts`, `catchJudge.ts`, HUD tables in
   `ScoreReplayModal.tsx` — status: verified by `std.test.ts`, `taiko.test.ts`,
   `catch.test.ts`.

2. **HR** on standard flips Y and raises AR/OD, but does **not** shrink CS.
   **HR** on catch flips X and **does** scale CS (smaller plate). Taiko has no
   playfield flip.
   **Source:** `stdJudge.ts:adjustStdDifficulty`, `catchJudge.ts:adjustCatchDifficulty`

3. Preview and rewatch accept native Mode only (`0`/`1`/`2`/`3`). Converted
   maps (Mode 0 played as taiko/catch) stay unsupported (422 / `supported: false`).

4. Live Play and replay analysis stay **mania only**.

5. Skins are separate stores: `roxysu:preview-skin` (mania), `roxysu:std-skin`,
   `roxysu:taiko-skin`, `roxysu:catch-skin`.

6. An **imported mania skin** can replace the procedural mania skin per keymode.
   Drop an `.osk` or `skin.ini` folder on Skin → Mania, beatmap preview, or score
   rewatch, or use Skin → Mania **Import .osk** (`ManiaSkinFileButton`). A confirm
   modal previews the skin and asks which keymodes to apply.
   Layout (column widths, spacing, hit position) and sprites (notes, LN, keys,
   stage) come from `skin.ini` `[Mania]` sections. Image blobs persist in
   IndexedDB (`roxysu-mania-skin`); JSON metadata stays in `roxysu:preview-skin`.
   Reset keymode / reset all deletes those blobs.
   Procedural skins also expose a uniform **column spacing** slider (fraction of
   one column’s share, 0–40%) on Skin → Mania; paint reuses `layoutManiaPlayfield`
   for both imported and procedural paths.
   LN bodies from imported skins are drawn osu!-style (`drawHoldBodyTiled` in
   `paintManiaNotefield.ts`): the body image is sampled from its top for exactly
   the pixels the hold needs, wrapping to the image top when the hold is taller
   than one image. Tall body images with transparent lower portions therefore
   fade out toward the tail exactly like in-game; the image is never stretched
   vertically.

7. Taiko scroll is a user skin setting (`scrollSpeed`), not BPM/SV.

8. Catcher width is `106.75 * |1 - 0.7 * (cs - 5) / 5|` times skin
   `catcherScale` (default `0.7`). Hyperdash is a visual flag from walk-speed vs
   next fruit distance. When preview has no replay frames, the catcher lerps
   across fruits and large droplets so it sits on each object at hit time.
   The catcher is `roxyctb.png` (Roxy holding a plate); the plate in the
   art is the catch surface — no extra platter is drawn.

9. Judges are visual-quality approximations, not full lazer sims.

10. Preview and rewatch match the pattern-conversion mods **Invert (IN)** and
    **Hold Off (HO)**: mania charts are converted before display/judging so
    playback shows the chart lazer actually played. Rewatch derives IN/HO from
    the score's mods (`parseScoreMods` → `loadChartForScore`); preview takes an
    optional `mods` query param (acronyms `MR|IN|HO`, others dropped) plus an
    NM/MR/IN/HO pill picker in the modal. Conversions reuse
    `OsuFileParser.modIN()` / `modHO()` via `applyManiaPatternMods`
    (Invert then Hold Off, Sunny order). Invert is a start-based approximation:
    each note becomes an LN ending `max(d/2, d − beatLength/4)` before the next
    note in its column, and a column's trailing note is dropped — same as the
    Sunny dan estimator. Mirror flips columns after conversion.
    **Source:** `replay/loadChart.ts:applyManiaPatternMods`,
    `routes/scores.ts` mania branch, `routes/beatmaps.ts` `/:id/preview`,
    `replay/mods.ts:parsePatternModQuery` — status: verified by
    `patternMods.test.ts`, `mods.test.ts`.

11. The preview modal shows a **mod-aware Sunny dan** chip next to the mod
    pills, fed by `GET /api/beatmaps/:id/sunny-dan?mods=&rate=`. Base combos
    (rate 1, no IN/HO) read the Sunny dan ratings store; modded combos prefer a
    persisted dan difficulty variants row and otherwise estimate ephemerally.
    Ephemeral results are never persisted — variant rows are written only by
    the background job.
    **Source:** `map-analysis/computeSunnyDan.ts:getSunnyDanForPatternMods`,
    `routes/beatmaps.ts` `/:id/sunny-dan`, `BeatmapPreviewModal.tsx` Sunny chip,
    `lib/api.ts:fetchBeatmapSunnyDan` — status: verified by
    `beatmapsPreview.test.ts`.

## Security rules

None — no access control on preview/replay/skin data beyond existing score owner
scope.

## Important states

- **Preview**: frames/judgments hidden; animations run from `getCurrentTimeMs()`.
  Catch synthesizes perfect catcher motion from hit objects.
- **Rewatch**: replay frames drive cursor / keys / catcher; judgments drive flash
  and HUD.
- **Hidden (HD)**: objects fade across the final 40% of the approach.

## Main flows

```text
Beatmap preview:
  user selects beatmap (+ optional mania mod pills NM/MR/IN/HO)
    → fetchBeatmapPreview(beatmapId, mods) → parseStd / parseTaiko / parseCatch / OsuFileParser
    → applyManiaPatternMods (IN/HO, then Mirror column flip)
    → render matching playfield + skin

Score rewatch:
  user selects score
    → fetchScoreReplay → load*Chart + *Judge (mania chart pre-converted per score IN/HO mods)
    → ScoreReplayModal HUD uses per-ruleset weights
    → matching playfield draws frames + judgments

Imported mania skin:
  drop .osk / skin folder  OR  Skin → Import .osk file picker
    → unzip + parse skin.ini
    → confirm modal (preview + keymode picker)
    → persist sprites in IndexedDB + layout on preview skin
    → paintManiaNotefield draws sprites / stage / column layout
```

## Implementation

- Paint modules are pure; React wrappers are rAF via `startPlayfieldRaf`.
  The loop skips `paint*` when map time and a snapshot (size, skin, mask,
  notes) are unchanged, and cancels while `document.hidden`. Video export
  calls the same paint.
- Score rewatch HUD ticks incrementally through judgments and calls `setHud`
  only when combo / accuracy / last result change. Paused + unchanged time
  skips the scan. Overlay lives in memoized `ReplayHudOverlay`.
- Fat API payload: unused `notes` / `hitObjects` / `taikoHitObjects` /
  `catchHitObjects` / frame arrays are `[]`. Preview responses echo
  `appliedMods` for the pattern conversions actually applied.
- Preview modal keys its preview query and the Play-mode `LiveManiaPlay` cache
  on the selected mod list so switching IN/HO/MR refetches notes and rebuilds
  judging instead of reusing the unconverted chart.
- `BeatmapPreviewEmbed` (Now Selected page, overlay preview element) accepts
  `matchMods` — callers pass the tosu snapshot's raw mods JSON so the embedded
  preview auto-matches the in-game MR/IN/HO selection; its query key is
  `["beatmap-preview-embed", beatmapId, modsKey]`.
- Store / dispatch names: `"mania"`, `"osu"`, `"taiko"`, `"fruits"`.
- `lib/osuSkinIni.ts` / `lib/maniaSkinImport.ts` — .osk parse + IndexedDB sprites.

## Dependencies

- `packages/osu-chart` — parsers for all four rulesets.
- `apps/server/src/replay/*Judge.ts` — judgment computation.
- `lib/api.ts` — `fetchBeatmapPreview`, `fetchScoreReplay`.

## Depended on by

- Skin stores consumed by playfields, preview/rewatch modals, embed, and editors.
- [replay-video-export/](../replay-video-export/index.md)
- [now-selected/](../now-selected/index.md)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Score rewatch, Taiko playfield, Catch playfield, Imported mania skin
- [replay-video-export/](../replay-video-export/index.md)
- [architecture/client-theme.md](../../architecture/client-theme.md)
