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
