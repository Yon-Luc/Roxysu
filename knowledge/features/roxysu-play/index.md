---
last_verified: 2026-08
confidence: verified
touches:
  - apps/play/
  - apps/play/src/app.tsx
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
3. On NixOS, launch from the flake dev shell so GPUIX can `dlopen` Wayland /
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
- TypeScript requires `"jsxImportSource": "@gpuix/react"`.
- Flake: `gpuixRuntimeDeps` + `LD_LIBRARY_PATH` / `NIX_LD_LIBRARY_PATH` /
  `XKB_CONFIG_ROOT=/etc/X11/xkb` so prebuilt `@gpuix/native` resolves libs on NixOS.
- Root script: `bun run play`.

## Important symbols

- `apps/play/src/app.tsx` — `render(<App />, { title: "Roxysu Play", ... })`
- `flake.nix` — `gpuixRuntimeDeps`, `runtimeLibraryPath`

## UI component architecture

`apps/play/src/components/ui/dialog.tsx` is the reference pattern for window-level
surfaces (Dialog, Sheet, CommandDialog). Structure:

```
DialogViewport (FloatingLayer, sideOffset 0, full-window flex-centered)
├── DialogBackdrop (absolute dim scrim, optional for fullscreen)
└── DialogSurface (the card / fullscreen surface)
```

- `FloatingLayer` is reused as a **centered viewport**, not an anchored popover. The
  anchored layer is stretched to the window and centered via flex; it is not
  positioned relative to the trigger.
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
