---
last_verified: 2026-08
confidence: verified
touches:
  - apps/overlay/main.c
  - apps/overlay/build.sh
  - flake.nix
---

# In-game overlay

## Purpose

Standalone Wayland host (`apps/overlay`) that draws the existing `/overlay` HUD
page above fullscreen osu!lazer on wlr-layer-shell compositors (Hyprland, sway,
niri, river, KDE). No injection into lazer — a sibling surface on the Wayland
`overlay` layer.

## Business rules

1. Data reaches the HUD **only** through client-app HTTP (`GET /api/overlay`,
   same page as the OBS browser-source route `#/overlay?bg=clear`). The host
   never touches Realm or the local mirror directly.
2. The surface is display-only: always click-through (empty input region via
   `wl_surface_set_input_region`) and keyboard mode `NONE`.
3. The host paints no background of its own (window + webview forced
   transparent via CSS); all translucency comes from the page's `bg=clear`
   variant. Without this the GtkWindow theme color shows through as grey.
4. Linux + zwlr_layer_shell_v1 only. On X11 / non-layer-shell compositors it
   exits with guidance to use the same URL as an OBS browser source instead.
5. The host is version-agnostic to lazer; only the compositor contract matters.
6. Layer placement: `OVERLAY` layer, `exclusive_zone = -1`, anchored corner per
   `--anchor`, so panels/fullscreen windows never displace it.
7. **Focus following** (default on): via `zwlr_foreign_toplevel_management`,
   the surface shows only while a window whose `app_id` (fallback title)
   contains `--match-app-id` (default `osu`) is activated. Compositors without
   that protocol degrade to always-visible with a stderr notice.
   `--follow-focus 0` disables; `--list-windows` dumps app_id/title/focused
   state for tuning the match string.
8. Visibility is a hard map/unmap of the layer surface. Softer approaches all
   failed in practice: GTK4 opacity is ignored on Wayland toplevels and does
   not reach WebKitGTK's composited output; injected page-visibility JS
   commits stall because the compositor never recomposes an unchanged-mapped
   overlay above fullscreen games (visual state lagged events by one
   focus-period until each fullscreen enter/exit forced recomposition).
9. Every remap reasserts placement (`set_layer(TOP)` then
   `set_layer(OVERLAY)`, plus queue_draw and page-visibility reset) so the
   compositor re-slots the fresh surface above fullscreen windows instead of
   leaving remapped overlays below them.
10. Focus tracking uses its own Wayland event queue + GSource on the GDK
   connection; protocol C code is generated at build time by wayland-scanner
   from wlr-protocols into `apps/overlay/gen/` (gitignored).

## Main flow

```
apps/overlay (C: GTK4 + gtk4-layer-shell + WebKitGTK 6)
    │  loads http://127.0.0.1:<port>/#/overlay?limit=N&bg=clear
    ▼
client app server → GET /api/overlay (live session / recent scores)
```

Build: `nix develop` → `./apps/overlay/build.sh` (wayland-scanner generates
protocol code) → `./roxysu-overlay`
(flags: `--url --anchor --margin --width --height --opacity --output
--match-app-id --follow-focus --list-windows`).

## Important symbols

- `apps/overlay/main.c` — host entry point
- `apps/server/public/features/overlay/OverlayPage.tsx` — rendered HUD page
- `apps/server/src/routes/overlay.ts` — `/api/overlay`

## Dependencies

- [dashboard/](dashboard/index.md) — owns the `/api/overlay` endpoint
- [tosu-live/](tosu-live/index.md) — live-session detection behind that payload
- external: wlr-layer-shell compositor, WebKitGTK

## Depended on by

- (entry surface; nothing depends on this feature)

## Related knowledge

- [vocabulary.md](../vocabulary.md) — In-game overlay
- [features/overlay-editor/](../overlay-editor/index.md) — profiles behind `?profile=` URLs
- [architecture/process-model.md](../architecture/process-model.md) — sibling process model
