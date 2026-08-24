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

## Main flow

```
apps/overlay (C: GTK4 + gtk4-layer-shell + WebKitGTK 6)
    │  loads http://127.0.0.1:<port>/#/overlay?limit=N&bg=clear
    ▼
client app server → GET /api/overlay (live session / recent scores)
```

Build: `nix develop` → `./apps/overlay/build.sh` → `./roxysu-overlay`
(flags: `--url --anchor --margin --width --height --opacity --output`).

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
- [architecture/process-model.md](../architecture/process-model.md) — sibling process model
