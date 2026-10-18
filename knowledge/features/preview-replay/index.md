---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/components/BeatmapPreviewModal.tsx
  - apps/server/public/components/BeatmapPreviewButton.tsx
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
  - apps/server/public/features/now-selected/NowSelectedPage.tsx
  - apps/server/public/features/overlay/OverlayElements.tsx
  - apps/server/public/components/ScoreReplayModal.tsx
  - apps/server/public/components/JudgmentCounterOverlay.tsx
  - apps/server/public/components/previewPrefs.ts
  - apps/server/public/components/previewPrefs.test.ts
  - apps/server/public/lib/previewSkin.test.ts
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
  - apps/server/public/lib/keybinds.ts
  - apps/server/public/lib/osuSkinIni.ts
  - apps/server/public/lib/maniaSkinImport.ts
  - apps/server/public/lib/stdSkinImport.ts
  - apps/server/public/lib/catchSkinImport.ts
  - apps/server/public/lib/stdHitsoundPlayer.ts
  - apps/server/public/lib/useStdHitsounds.ts
  - apps/server/public/lib/overlaySkins.ts
  - apps/server/public/components/ManiaSkinImportModal.tsx
  - apps/server/public/components/ManiaSkinDropHost.tsx
  - apps/server/public/components/ManiaSkinRealmImportButton.tsx
  - apps/server/public/components/StdSkinImportControls.tsx
  - apps/server/public/components/CatchSkinImportControls.tsx
  - apps/server/src/routes/skins.ts
  - apps/realm-reader/src/syncRealmSkins.ts
  - packages/db/src/schema.ts
  - apps/server/public/lib/api.ts
  - apps/server/public/lib/stdSkin.ts
  - apps/server/public/lib/taikoSkin.ts
  - apps/server/public/lib/catchSkin.ts
  - apps/server/public/features/settings/KeybindModal.tsx
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
  - packages/osu-chart/src/stdTypes.ts
  - packages/osu-chart/src/parseTaiko.ts
  - packages/osu-chart/src/parseCatch.ts
  - packages/osu-chart/src/catchTypes.ts
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

5c. **Standard playfield fidelity:** `parseStd` keeps `newCombo` / `comboOffset`
    and beatmap `[Colours]` ComboN. Combo numbers reset on new combo / after
    spinner; colour index advances by `1 + comboOffset`. Palette priority:
    palette: when an **imported standard skin** is active, skin combo colours
    win (ignore-beatmap-skin); otherwise beatmap ComboN → skin → defaults.
    Skin.ini combo colours are stored in **Combo2…Combo1** cycle order.
    Painter draws follow points, snaking slider bodies, reverse arrows, follow
    circle on the ball, and combo-tinted approach rings (skin `approach`
    overrides when not default white).
    Object coords stay in 512×384; the drawn border is expanded by circle
    radius on each side (lazer `ApplyCircleSizeToPlayfieldBorder`) so edge
    hitcircles fit inside the rectangle. The padded playfield is fitted into
    **80%** of the stage (`playfield_size_adjust`), matching stable/lazer
    proportions so circles are not oversized relative to the view.
    **Source:** `parseStd.ts`, `stdSkin.ts:resolveComboPalette`,
    `paintStdPlayfield.ts:buildComboInfo`, `playfieldTransform` — status:
    verified by `parseStd.combo.test.ts`, `osuSkinIni.test.ts`,
    `paintStdPlayfield.test.ts`.

5d. An **imported standard skin** can replace procedural std drawing with legacy
    sprites and play skin hitsounds. Skin → Standard **Import .osk** / **Import
    from game** (same Realm skin archives as mania). Sprites + `std:hs:*`
    sample blobs in IndexedDB `roxysu-std-skin`; metadata on `roxysu:std-skin`
    `imported`. `skin.ini` `[Colours]` feeds combo (Combo2-first cycle),
    SliderBorder / SliderTrackOverride / SliderBall / SpinnerBackground /
    cursor; `LayeredHitSounds` is stored on import meta. Missing sprites fall
    back per element. Overlay push includes `std:*` sprite keys alongside mania
    sprites.
    Fidelity notes: hitcircle/approach use **multiplicative** combo tint
    (`multiply` + `destination-in` alpha restore); slider ball loads
    `sliderb` / `sliderbN`; followpoints rotate along the segment; slider
    body fill uses combo colour unless `SliderTrackOverride` is set; import
    sets `hitCircleScale` to 1.0; draw order is body → followpoints →
    approach → circle → numbers → overlay → reverse → ball.
    Hitsounds: chart keeps `hitSound` / `hitSample` + `sampleTiming`; client
    `stdHitsoundPlayer` schedules discrete hitnormal/whistle/finish/clap and
    slidertick from the song clock (slide/spin loops and beatmap custom samples
    deferred). Bad/closed sprites never blank the playfield.
    Standard/catch rewatch letterbox uses `useAspectFit` with a **state**
    outer element so ResizeObserver attaches after replay data mounts.
    **Source:** `stdSkinImport.ts`, `stdHitsoundPlayer.ts`, `useStdHitsounds.ts`,
    `paintStdPlayfield.ts`, `ScoreReplayModal.tsx`, `StdSkinImportControls.tsx`,
    `overlaySkins.ts` — status: verified by `stdSkinImport.names.test.ts`,
    `stdHitsoundPlayer.test.ts`, `osuSkinIni.test.ts`,
    `paintStdPlayfield.test.ts`.

5b. **Keybinds** are browser-local: column keys (`roxysu:keybinds`) per keymode
    and playback **action keybinds** (`roxysu:action-keybinds`) for preview /
    play / rewatch (restart, play/pause, seek, enter play, etc.). Escape stays
    fixed. In Play mode **column keys win** over action shortcuts when a code
    is bound to a column. Preview and score rewatch open `KeybindModal` in place
    (no navigate-away); Settings → Appearance → Keybinds uses the same modal.
    **Source:** `lib/keybinds.ts`, `KeybindModal.tsx`, `BeatmapPreviewModal.tsx`,
    `ScoreReplayModal.tsx`.

6. An **imported mania skin** can replace the procedural mania skin per keymode.
   Drop an `.osk` or `skin.ini` folder on Skin → Mania, beatmap preview, or score
   rewatch, use Skin → Mania **Import .osk** (`ManiaSkinFileButton`), or
   **Import from game** (`ManiaSkinRealmImportButton`) to pick a **Realm skin**
   that has `skin.ini`. Realm skins are extracted on full sync / reconcile into
   `realm_skins` / `realm_skin_files`; `GET /api/skins` lists importable rows and
   `GET /api/skins/:id/archive` zips hashed lazer files for the existing draft
   pipeline. A confirm modal previews the skin and asks which keymodes to apply.
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
   next fruit distance (half-width aligned with judge plate tolerance). When
   preview has no replay frames, the catcher lerps across fruits and large
   droplets so it sits on each object at hit time. Default catcher is a
   **procedural plate** (CS-scaled capsule + body, face-flipped from motion);
   imported `fruit-catcher-*` / `fruit-ryuuta` sprites replace it. Hyperdash
   draws a dashed path to the next fruit, afterimage trail tint, and fruit
   outline from `[CatchTheBeat]` / skin HyperDash* colours. Caught fruit /
   large droplets flash a catch-line explode (optional `lighting` sprite).

8b. **Catch playfield fidelity:** `parseCatch` keeps `newCombo` / `comboOffset`
    / `indexInBeatmap` on fruits and beatmap `[Colours]` ComboN. Combo colour
    index advances like Standard (`1 + comboOffset` on new combo). Palette:
    when an **imported catch skin** is active, skin combo colours win;
    otherwise beatmap → skin → defaults. Fruit visual cycles
    pear → grapes → apple → orange by `indexInBeatmap % 4`.
    **Source:** `parseCatch.ts`, `catchSkin.ts:resolveCatchComboPalette`,
    `paintCatchPlayfield.ts:buildCatchComboInfo` — status: verified by
    `parseCatch.combo.test.ts`, `paintCatchPlayfield.test.ts`.

8c. An **imported catch skin** replaces procedural fruit/droplet/banana/catcher
    drawing with legacy sprites. Skin → Catch **Import .osk** / **Import from
    game**. Sprites in IndexedDB `roxysu-catch-skin` (`catch:*`); metadata and
    `[CatchTheBeat]` HyperDash / HyperDashFruit / HyperDashAfterImage on
    `roxysu:catch-skin` `imported`. Missing sprites fall back per element.
    Overlay push includes `catch:*` sprite keys.
    **Source:** `catchSkinImport.ts`, `CatchSkinImportControls.tsx`,
    `osuSkinIni.ts` `[CatchTheBeat]`, `overlaySkins.ts` — status: verified by
    `osuSkinIni.test.ts`.

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

12. Score rewatch and Play (preview modal and score modal) show running judgment
    counts on the playfield: perfect / great / good / ok / meh / miss, including
    zeros, stacked vertically. Counts advance with map time (rewatch, same scan
    as combo / accuracy, tails included) or with hits (Play, from `LiveManiaPlay`
    summary). Combo and accuracy are separate playfield chips (Play also shows
    max combo on the combo chip; rewatch accuracy shows the last result). All
    three chips drag on the playfield and up to 200px past its left or right
    edge; centers are saved as % of the playfield on the preview prefs store. Preview without Play has none of them. They are not drawn on
    replay video export.
    **Source:** `JudgmentCounterOverlay.tsx`, `previewPrefs.ts` `counterX` /
    `comboX` / `accuracyX`, `ScoreReplayModal.tsx` HUD scan,
    `BeatmapPreviewModal.tsx` Play branch.

13. Playfield **Size** (`fieldWidth`, 15–100%, default 55) is saved **per
    ruleset** (`osu` / `taiko` / `fruits` / `mania`) under
    `rx-beatmap-preview` → `playfield`. For mania it is also **per keymode**
    (`4|6|7|8|9|10`). Mania **Scroll** is per keymode on the same map. Mania
    and taiko apply Size as max-width; standard and catch rewatch scale the
    fitted 4:3 by that percentage. Legacy flat `scroll` / `fieldWidth` migrate
    onto every slot on load.
    **Source:** `previewPrefs.ts` (`resolvePlayfieldFieldWidth`,
    `resolveManiaScroll`, `loadPrefs`), `ScoreReplayModal.tsx`,
    `BeatmapPreviewModal.tsx` — status: verified by `previewPrefs.test.ts`.

14. Mania procedural **Hit** position and **lane Cover** live on each
    `KeymodeSkin` (not a shared skin root). Skin → Mania tabs and preview
    modal sliders write the active keymode only. Imported skins still override
    hit position from `skin.ini` per keymode. Legacy root `hitPosition` /
    `laneCover` copy onto every keymode on parse.
    **Source:** `previewSkin.ts` (`parsePreviewSkinJson`, `patchKeymodeSkin`),
    `SkinPage.tsx`, `ManiaNotefield.tsx` — status: verified by
    `previewSkin.test.ts`.

Volume, rate, fullscreen, HUD chip positions, blackBg, and analysis stay
shared across rulesets and keymodes.

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
    OR  Skin → Import from game (Realm skin list → archive zip)
    → unzip + parse skin.ini
    → confirm modal (preview + keymode picker)
    → persist sprites in IndexedDB + layout on preview skin
    → paintManiaNotefield draws sprites / stage / column layout

Imported standard skin:
  Skin → Standard Import .osk / Import from game
    → unzip + parse skin.ini ([Colours] Combo2-first + LayeredHitSounds + std sprites/samples)
    → confirm modal (StdPlayfield preview)
    → persist sprites + std:hs:* samples in IndexedDB (roxysu-std-skin) + imported meta
    → paintStdPlayfield draws sprites; stdHitsoundPlayer plays samples on the clock

Imported catch skin:
  Skin → Catch Import .osk / Import from game
    → unzip + parse skin.ini ([Colours] + [CatchTheBeat] + fruit/catcher sprites)
    → confirm modal (CatchPlayfield preview)
    → persist sprites in IndexedDB (roxysu-catch-skin) + imported meta on catch-skin
    → paintCatchPlayfield draws sprites with procedural plate/fruit fallback

Realm skin extract (full / reconcile):
  realm-reader reads Realm Skin + Files
    → upsert realm_skins / realm_skin_files (hasSkinIni denormalized)
    → client lists via GET /api/skins
```

## Implementation

- Paint modules are pure; React wrappers are rAF via `startPlayfieldRaf`.
  The loop skips `paint*` when map time and a snapshot (size, skin, mask,
  notes) are unchanged, and cancels while `document.hidden`. Video export
  calls the same paint.
- Score rewatch HUD ticks incrementally through judgments and calls `setHud`
  only when combo / accuracy / last result change (counts ride the same update).
  Paused + unchanged time   skips the scan. Combo, accuracy, and running counts are draggable playfield
  chips (`ComboHudOverlay`, `AccuracyHudOverlay`, `JudgmentCounterOverlay`).
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
- `lib/osuSkinIni.ts` / `lib/maniaSkinImport.ts` / `lib/stdSkinImport.ts` /
  `lib/catchSkinImport.ts` — .osk parse + IndexedDB sprites (mania + standard +
  catch).
- `routes/skins.ts` / `syncRealmSkins.ts` — Realm skin catalog + archive for Import from game.
- Preview/rewatch std and catch payloads include `comboColors` and hit-object
  combo flags from `parseStdChart` / `parseCatchChart`.

## Dependencies

- `packages/osu-chart` — parsers for all four rulesets.
- `apps/server/src/replay/*Judge.ts` — judgment computation.
- `lib/api.ts` — `fetchBeatmapPreview`, `fetchScoreReplay`.

## Depended on by

- Skin stores consumed by playfields, preview/rewatch modals, embed, and editors.
- [replay-video-export/](../replay-video-export/index.md)
- [now-selected/](../now-selected/index.md)
- [tosu-counter/](../tosu-counter/index.md) — standalone counter reuses the
  mania painter + skin defaults; the paint modules are dependency-free pure
  modules (`clamp` lives in `lib/clamp.ts`, `PreviewNote` is local to
  `paintManiaNotefield.ts`) so they bundle without React or `lib/api.ts`.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Score rewatch, Taiko playfield, Catch playfield, Imported mania skin, Imported standard skin, Imported catch skin
- [replay-video-export/](../replay-video-export/index.md)
- [architecture/client-theme.md](../../architecture/client-theme.md)
