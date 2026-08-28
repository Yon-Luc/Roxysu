---
last_verified: 2026-08
confidence: verified
touches:
  - apps/play/
  - apps/play/src/app.tsx
  - apps/play/src/game/
  - apps/play/src/database/
  - apps/play/src/assets/
  - apps/play/package.json
  - apps/play/scripts/dev.sh
  - flake.nix
  - package.json
---

# Roxysu Play

## Purpose

Native GPU-accelerated playground for Roxysu UI, using GPUIX (React bindings
for Zed's GPUI). Exists to explore a non-Electron desktop surface.

## Business meaning

**Roxysu Play** is an experimental app. It does not serve practice analytics,
touch Realm, or replace `apps/desktop`. Product surfaces here are prototypes
until explicitly promoted.

## Business rules

1. Play is optional developer tooling — not required to run the client app.
2. Play must not write Realm or the local mirror until a verified design says so.
3. Play opens the shared Roxysu SQLite catalog in **read-only** mode (M1); score/settings writes come later.
4. Play resolves osu!lazer binary assets via SHA-256 hashes through a lazer asset resolver — it does not duplicate the `files/` store.
5. On NixOS, launch from the flake dev shell so GPUIX can `dlopen` Wayland /
   Vulkan / X11 (see Implementation).

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
- M2 vertical slice: beatmap load/parse, timeline audio clock, input, gameplay judging, playfield renderer.
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
- `apps/play/src/play/PlayView.tsx` — GPUIX presentation shell
- `apps/play/src/database/RoxysuDatabase.ts` — shared SQLite open + availability detection
- `apps/play/src/assets/LazerAssetResolver.ts` — hash → lazer `files/` path resolution
- `apps/play/src/test.tsx` — legacy VSRG benchmark (preserved)
- `flake.nix` — `gpuixRuntimeDeps`, `runtimeLibraryPath`

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

## Depended on by

- Nothing yet

## Side effects

Opens a native OS window; quits when the last window closes (GPUIX default).

## Failure behavior

- NixOS without flake env + Wayland session → `NoWaylandLib` panic at init.
- Workaround without flake: unset `WAYLAND_DISPLAY` to force X11 (if X11 libs resolve).

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — **Roxysu Play**
- [architecture/tech-stack.md](../../architecture/tech-stack.md)
- [desktop/](../desktop/index.md) — Electron shell (different stack)
