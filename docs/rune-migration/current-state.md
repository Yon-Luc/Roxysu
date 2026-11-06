# Roxysu Play — current state (GPUIX baseline)

**Baseline commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
**Branch:** `play/rune-migration`  
**Recorded:** 2026-11-06T18:20:58Z  
**Host at record time:** NixOS, kernel 6.18.59, `WAYLAND_DISPLAY=wayland-1`, `XDG_CURRENT_DESKTOP=KDE` (niri 26.04 also installed)

This document inventories the existing GPUIX Roxysu Play app before any Rune work. Source is authoritative; cells marked **pending measurement** need a live session.

## Startup and shutdown

```
bun run play
  → apps/play/scripts/dev.sh
  → bun --hot apps/play/src/app.tsx
  → @gpuix/react render(<App />, gpuixRenderOptions({ title, width, height }))
  → native GPUI window + frame loop
```

- On NixOS, launch from `nix develop` so `@gpuix/native` can `dlopen` Wayland / Vulkan / X11 (`flake.nix` `gpuixRuntimeDeps`, `LD_LIBRARY_PATH`, `XKB_CONFIG_ROOT`).
- Hot reload: Bun remounts React; native `.node` cannot unload (see `GPUIX_CONSTRAINTS.md`).
- Shutdown: closing the single GPUIX window ends the process. No separate overlay host is spawned by Play.

Alternate entries (not the product shell):

| Entry | Role |
|---|---|
| `apps/play/src/app.tsx` | Main Roxysu Play shell |
| `apps/play/src/test.tsx` | Legacy benchmark / playground (`titlebarTransparent` experiments) |
| `apps/play/src/texture-refresh-test.tsx` | Playfield texture experiment (`dev:texture-test`) |
| `apps/play/src/playground.tsx` | UI component playground |

## Windows and surfaces

| Feature / window | Current behaviour | Data source | Platform-specific dependency | Priority |
|---|---|---|---|---|
| Main Play window | Single opaque GPUIX window 1100×900, title “Roxysu Play” | Local mirror (`play_*` + catalog reads), lazer hashed files | `@gpuix/native` dlopen via flake; Linux ignores `focus: false` | High |
| Song select | Collection filter, sort, beatmap list, insights panel | `@roxysu/db` / CollectionRepository, BeatmapInsightsRepository | None beyond GPUIX | High |
| Countdown | Pre-play countdown overlay inside the same window | Game state | None | Medium |
| Play / pause | Mania playfield + HUD inside the same window | GameplayEngine, PlayfieldRenderer, AudioEngine | miniaudio_node; skin PNGs from lazer | High |
| Results | Post-play stats | play_sessions / PlayResult | None | Medium |
| Settings | In-shell settings UI | `play_settings` | Native file dialog for skin paths | Medium |
| OS-level overlay HUD | **Not in Play** — separate `apps/overlay-rs` (GTK4 + WebKit + gtk4-layer-shell, click-through via empty Gdk input region) | Overlay-rs own RAM telemetry; Electron settings spawn binary | Wayland layer-shell | Contrast only |

Play does **not** currently implement transparent, borderless, always-on-top, or click-through OS windows. UI “transparent” colours are widget-local fills only.

## User-facing features and shortcuts

Phases (from `GameState`): `SONG_SELECT` → `COUNTDOWN` → `PLAYING` / `PAUSED` → `RESULTS`.

| Input | Behaviour |
|---|---|
| Default 7K lane keys `s d f space j k l` | Hit notes during play (`KeyBindings.ts`) |
| Pause / resume / quit controls | Buttons in `PlayView` (pause when PLAYING; resume when PAUSED) |
| Dialog / sheet Escape | Dismiss floating UI (`dialog.tsx`, `sheet.tsx`, etc.) |
| GPUIX_BACKGROUND=1 | Request background focus on macOS/Windows; **ignored on Linux** |

No global OS hotkeys for show/hide overlay — Play has no overlay window.

## Telemetry / live data

| Source | Present in Play? |
|---|---|
| tosu WebSocket `/websocket/v2` | No (lives in `apps/tosu-counter`) |
| Realm live hooks | No — Play reads the shared Roxysu SQLite catalog |
| Overlay-rs process/RAM telemetry | No — separate binary |

Play “updates” are the game loop / React snapshot (`frameVersion`, song time, combo, score, accuracy), not an external telemetry bus.

## Resource / frame baseline

| Measurement | Idle | Gameplay |
|---|---|---|
| CPU | pending measurement | pending measurement |
| GPU | pending measurement | pending measurement |
| Resident memory | pending measurement | pending measurement |
| Frame pacing / stutter | pending measurement | pending measurement |
| Representative screenshots | pending capture | pending capture |

## Platform notes (GPUIX)

- Documented in `apps/play/src/components/ui/GPUIX_CONSTRAINTS.md`.
- Linux: `focus: false` does not keep the window unfocused.
- NixOS: missing Wayland libs → panic `NoWaylandLib` if Wayland is selected.
- No gtk-layer-shell usage in Play.

## Contrast: existing overlay host

`apps/overlay-rs` already proves Wayland overlay + click-through on this machine class via GTK/WebKit. The Rune prototype evaluates whether Rune’s `WindowOptions::overlay` / layer-shell path can meet similar needs for a future Play presentation layer — it does **not** replace `overlay-rs` in this session.
