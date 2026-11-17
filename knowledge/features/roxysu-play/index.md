---
last_verified: 2026-11
confidence: verified
touches:
  - apps/play/
  - apps/play/src/app.tsx
  - apps/play/src/game/
  - apps/play/src/database/
  - apps/play/src/songselect/SongSelect.ts
  - apps/play/src/assets/
  - apps/play/package.json
  - apps/play/scripts/dev.sh
  - apps/play-rune/
  - apps/play-rune/src/catalog.rs
  - apps/play-rune/src/chart.rs
  - apps/play-rune/src/gameplay.rs
  - apps/play-rune/src/play_view.rs
  - apps/play-rune/src/playfield_raster.rs
  - apps/play-rune/src/model.rs
  - apps/play-rune/src/settings.rs
  - apps/play-rune/src/keybinds.rs
  - apps/play-rune/src/shell.rs
  - docs/rune-migration/
  - flake.nix
  - package.json
---

# Roxysu Play

## Purpose

Native GPU-accelerated playground for Roxysu UI, using GPUIX (React bindings
for Zed's GPUI). Exists to explore a non-Electron desktop surface.

A separate **Rune prototype** (`apps/play-rune`) evaluates whether the Rune
native UI framework can host transparent / topmost / click-through overlays on
Wayland, a Play-like shell backed by a **read-only local mirror** (mania 7K),
and a silent playfield/judgment slice. It does **not** replace GPUIX Roxysu
Play and must not be treated as the product shell until a documented go
decision. Migration notes live under `docs/rune-migration/`.

## Business meaning

**Roxysu Play** is an experimental app. It does not serve practice analytics,
touch Realm, or replace `apps/desktop`. Product surfaces here are prototypes
until explicitly promoted.

## Business rules

1. Play is optional developer tooling — not required to run the client app.
2. Play must not write Realm or Roxysu-owned sync/analytics tables; it may write dedicated `play_*` tables in the local mirror.
3. Play opens the shared Roxysu SQLite catalog for catalog reads; gameplay settings and local play sessions persist to `play_settings` / `play_sessions`.
4. Play resolves osu!lazer binary assets via SHA-256 hashes through a lazer asset resolver — it does not duplicate the `files/` store.
5. On NixOS, launch from the flake dev shell so GPUIX can `dlopen` Wayland /
   Vulkan / X11 (see Implementation).
6. Song select narrows a Realm collection to mania beatmaps of the selected key count in one query: ruleset short name and `circle_size` are conditions on the join that resolves collection hashes to beatmap ids. It does not look beatmaps up one by one.
   **Status:** verified
   **Enforced by:** `apps/play/src/database/CollectionRepository.ts:getRealmBeatmapIds()` called from `apps/play/src/songselect/SongSelect.ts`; test `apps/play/src/songselect/SongSelect.test.ts`
7. The Rune prototype must stay isolated from GPUIX Play: no shared process, and Rune must not write Realm or replace `play_*` persistence until explicitly promoted.
   **Status:** verified
   **Enforced by:** separate crate `apps/play-rune` (binary `roxysu-play-rune`); root script `bun run play:rune`
8. Rune prototype automated API smoke is available via `bun run play:rune:smoke` (`--acceptance-smoke`); it does not replace human click-through checks on Niri.
   **Status:** verified
   **Enforced by:** `apps/play-rune/src/main.rs` acceptance smoke thread; results recorded in `docs/rune-migration/platform-matrix.md`
9. Feel / FPS checks for the Rune playfield use `bun run play:rune:release` (debug is not the performance baseline). During play, `P` toggles present sink `Pixels` ↔ `NativeSurface` on the same chart clock; the perf LiveText reports fps and stage timings.
   **Status:** verified
   **Enforced by:** `apps/play-rune/run-release.sh`, `package.json` script `play:rune:release`, `PlaySession::toggle_sink()`
10. Rune play shows a live resource line (RSS, process CPU%, optional nvidia-smi GPU mem) and plays chart audio via rodio when the local mirror row has `audio_file_hash` resolving under lazer `files/`. Gameplay time is always wall-clock; audio starts after lead-in but does not drive the clock (avoids buffer-step stutter). `nvidia-smi` is sampled at most every 2s.
   **Status:** verified
   **Enforced by:** `apps/play-rune/src/resources.rs`, `apps/play-rune/src/audio.rs`, `PlaySession::song_time_ms()`
11. Rune play scroll speed matches GPUIX (pixels/second at display height; default 400). Skin sprites are optional PNG blits from lazer `skins/` (or `ROXYSU_PLAY_SKIN`); `I` toggles skin vs procedural fills so raster_ms can be compared on the perf HUD.
   **Status:** verified
   **Enforced by:** `apps/play-rune/src/playfield_raster.rs` (`pixels_per_ms`), `apps/play-rune/src/skin.rs`, `PlaySession::toggle_skin()`
12. Rune Settings tab (session-only, not persisted yet) controls playfield scale, hit position, stage offset, 7K keybinds, layout-edit default, and near-fullscreen resize. In play: F11 / Fullscreen button toggles window size to the primary display; F2 / Edit layout enables drag-to-move the stage (lazer-like); judgments spawn short column lighting + receptor bursts on the playfield raster.
   **Status:** verified
   **Enforced by:** `apps/play-rune/src/shell.rs` Settings tab, `apps/play-rune/src/keybinds.rs`, `PlaySession` layout Live offset + `HitFlash` in `playfield_raster.rs`, `Shared::toggle_fullscreen()`

## Security rules

None yet — no network auth surface. Revisit before any Hub or local-mirror access.

## Important states

| State | Meaning |
|---|---|
| Running under `bun --hot` | Window stays; save remounts React |
| Missing runtime libs (NixOS) | Panic `NoWaylandLib` if Wayland is selected and `libwayland-client` is not on `LD_LIBRARY_PATH` |

## Main flows

```
bun run play  (or: nix develop → bun run play)
  ↓
bun --hot apps/play/src/app.tsx
  ↓
@gpuix/react render() → native window + frame loop
```

## Implementation

- Entry: `apps/play/src/app.tsx` — must end with `render()` (idempotent under `--hot`).
- M6: song select sort; osu! skin loader (folder/.osk, installed skins catalog); default playfield skin.
- M4: settings (persisted), keybinds, audio lead-in, last beatmap restore, preview, countdown.
- M4 audio: native playback via miniaudio_node (OGG/MP3/FLAC from lazer files/), timeline fallback when unavailable.
- M5: Roxysu catalog integration — mastery, pattern analysis, mania ratings, collections, score history.
- M3/M4: judged notes hidden, judgment popups, searchable song select, results screen.
- Legacy benchmark preserved as `apps/play/src/test.tsx` (renamed from `app.tsx`).
- TypeScript requires `"jsxImportSource": "@gpuix/react"`.
- Flake: `gpuixRuntimeDeps` + `LD_LIBRARY_PATH` / `NIX_LD_LIBRARY_PATH` /
  `XKB_CONFIG_ROOT=/etc/X11/xkb` so prebuilt `@gpuix/native` resolves libs on NixOS.
- Root script: `bun run play`.
- Monorepo packages are consumed only through `integrations/` wrappers (`@roxysu/db`, `@roxysu/osu-paths`, `@roxysu/osu-chart`, `@roxysu/mania-judge`).

## Important symbols

- `apps/play/src/app.tsx` — play shell; `render(<App />, gpuixRenderOptions({ title: "Roxysu Play", ... }))`
- `apps/play/src/game/Game.ts` — lifecycle orchestrator wiring load → play → results
- `apps/play/src/beatmap/BeatmapLoader.ts` — hash → `.osu` → generic chart
- `apps/play/src/gameplay/GameplayEngine.ts` — headless mania judgment loop
- `apps/play/src/playfield/PlayfieldRenderer.ts` — typed-array VSRG renderer
- `apps/play/src/playfield/backends/CanvasPlayfieldBackend.ts` — CPU RGBA compositor (ready for `<surface>` sink)
- `apps/play/docs/gpuix-surface-pr-spec.md` — upstream PR spec for in-memory RGBA element
- `apps/play/src/playfield/PlayfieldCanvasLayer.tsx` — PNG ring experiment (not wired to PlayView)
- `apps/play/src/preview/PreviewController.ts` — isolated preview audio path
- `apps/play/src/database/PlaySettingsRepository.ts` — persisted play settings singleton
- `apps/play/src/database/PlaySessionRepository.ts` — local play results (`play_sessions`)
- `packages/db/src/schema.ts` — `play_settings`, `play_sessions` tables
- `apps/play/src/beatmap/BeatmapMetadata.ts` — PreviewTime / lead-in from `.osu`
- `apps/play/src/audio/createAudioEngine.ts` — native vs timeline backend selection
- `apps/play/src/integrations/miniaudio.ts` — miniaudio_node wrapper
- `apps/play/src/database/BeatmapInsightsRepository.ts` — mastery, patterns, ratings
- `apps/play/src/database/CollectionRepository.ts` — smart + Realm collections; `getRealmBeatmapIds()` takes an optional ruleset / key count filter
- `apps/play/src/songselect/BeatmapInsightsPanel.tsx` — Roxysu insights card
- `apps/play/src/results/ResultsView.tsx` — post-play results screen
- `apps/play/src/effects/JudgmentEffects.ts` — hit/miss popups from game events
- `apps/play/src/songselect/SongSort.ts` — song select sort options
- `apps/play/src/skin/SkinLoader.ts` — loads osu! legacy skins from folder or `.osk`
- `apps/play/src/skin/skinPaths.ts` — discovers installed skins under osu! data paths
- `apps/play/src/skin/defaultSkin.ts` — default playfield skin data
- `apps/play/src/database/RoxysuDatabase.ts` — shared SQLite open + availability detection
- `apps/play/src/assets/LazerAssetResolver.ts` — hash → lazer `files/` path resolution
- `apps/play/src/test.tsx` — legacy VSRG benchmark (preserved)
- `flake.nix` — `gpuixRuntimeDeps`, `runtimeLibraryPath`
- `apps/play-rune/` — isolated Rune overlay + fake telemetry prototype (pinned Rune git rev)
- `apps/play-rune/src/playfield_raster.rs` — half-res CPU playfield (210×280 → scaled display); RGBA/BGRA; hit flashes blend over lanes
- `apps/play-rune/src/model.rs:PlaySession` — raster present via `Pixels`/`NativeSurface`; rodio music; perf + resource LiveText
- `apps/play-rune/src/audio.rs` — rodio DeviceSink + Player; starts after lead-in; wall clock stays authoritative
- `apps/play-rune/src/resources.rs` — `/proc` RSS + CPU%; optional `nvidia-smi` per-pid GPU mem
- `apps/play-rune/src/settings.rs` — scroll, skin, playfield scale/hit/offset, lane keys, layout edit
- `apps/play-rune/src/keybinds.rs` — physical key name ↔ `PhysicalKeyCode` for 7K remaps
- `apps/play-rune/src/skin.rs` — minimal mania note/key PNG load for blit A/B
- `apps/play-rune/src/model.rs:PlaySession::tick()` — advances judgment + sink upload without view rebuild (rebuild only on sink toggle / scale / layout edit)
- `apps/play-rune/src/playfield_raster.rs:HitFlash` — mania-like lane lighting after judgments
- `docs/rune-migration/` — baseline, acceptance criteria, pin, platform matrix

## UI component architecture

`apps/play/src/components/ui/dialog.tsx` is the reference pattern for window-level
surfaces (Dialog, Sheet, CommandDialog). Structure:

```
DialogViewport (FloatingLayer, sideOffset 0, full-window flex-centered)
├── DialogBackdrop (absolute dim scrim, optional for fullscreen)
└── DialogSurface (the card / fullscreen surface)
```

- `FloatingLayer` is **not** used for the dialog viewport. `DialogViewport` renders the
  native `anchored` element directly and pins it to the window via an explicit
  `position={{ x: 0, y: 0 }}` + `anchor="topLeft"`, sized to the live window from
  `useWindowSize()`. This centers the modal on the window regardless of trigger
  position. `FloatingLayer` only anchors to a trigger sibling, so it cannot do this.
  (A dedicated `OverlayLayer` is the eventual home for this; until then, `anchored`
  with explicit `position` is the window-level primitive.)
- Scrim-click-to-close is wired on `DialogBackdrop`'s `onMouseDown`, **not** on the
  `FloatingLayer`'s `onMouseDownOutside`. A click on the scrim is a descendant of the
  anchored layer, so `onMouseDownOutside` never fires for it. Do not "simplify" this
  back to `onMouseDownOutside` — it will silently break `closeOnScrim`.
- The modal surface is always an opaque/translucent card. Backdrop blur is **not**
  designed into the Dialog API: GPUIX may expose native window vibrancy later, but it
  is treated as an optional primitive, not a Dialog requirement.
- `size` variants: `default | sm | lg | fullscreen`. `fullscreen` renders a full-window
  opaque surface with no scrim (not a transparent popover).
- Public parts: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogBody`,
  `DialogFooter`, `DialogTitle`, `DialogDescription`.

## Dependencies

- `@gpuix/react` / `@gpuix/native` (npm)
- Nix flake runtime libs on NixOS (Wayland, Vulkan, X11, libxkbcommon, …)
- Rune prototype only: `rune` crate pinned in `apps/play-rune/Cargo.toml` (see `docs/rune-migration/rune-pin.md`)

## Depended on by

- Nothing yet

## Side effects

Opens a native OS window; quits when the last window closes (GPUIX default).

Rune prototype opens a control window plus per-display overlay surfaces; closing
the control window closes overlays. Does not spawn or replace the **In-game overlay**
host (`apps/overlay-rs`).

## Failure behavior

- NixOS without flake env + Wayland session → `NoWaylandLib` panic at init.
- Workaround without flake: unset `WAYLAND_DISPLAY` to force X11 (if X11 libs resolve).
- Rune prototype: unsupported click-through logs `click-through: …` and continues.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — **Roxysu Play**, **In-game overlay**
- [architecture/tech-stack.md](../../architecture/tech-stack.md)
- [desktop/](../desktop/index.md) — Electron shell (different stack)
- [in-game-overlay/](../in-game-overlay/index.md) — production Wayland overlay host (not the Rune prototype)
- `docs/rune-migration/` — migration baseline and platform matrix
