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
8. Visibility after the first map toggles page-level visibility by injecting
   JS (`documentElement.style.visibility`) plus a best-effort widget fade on
   the view; the layer surface is never unmapped, because remapping makes
   some compositors (Hyprland, niri) drop the overlay below fullscreen
   windows. GTK4 opacity is unreliable here: it is ignored on Wayland
   toplevels, and does not reach WebKitGTK's hardware-composited output.
9. **Repaint forcing**: commits can stall while the surface sits above a
   fullscreen game (frame-callback starvation / direct-scanout caching), so a
   300ms tick re-requests a PAINT frame-clock phase, and while hidden it also
   wobbles window width by 1px (~1.2s cadence) to force a full-damage commit.
   Without this, hide/show visually lags events until the game's own
   fullscreen state changes.
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
