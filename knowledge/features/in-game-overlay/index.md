---
last_verified: 2026-08
confidence: verified
touches:
  - apps/overlay/main.c
  - apps/overlay/build.sh
  - flake.nix
  - nix/overlay.nix
  - nix/prebuilt.nix
  - nix/package.nix
  - apps/desktop/main.js
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/settings/sections/OverlayHostSection.tsx
  - packages/db/src/settings-keys.ts
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
8. **Self-heal**: a dead web process (OOM, GPU/DMA-BUF crash) leaves the last
   frame on screen forever — symptom: overlay freezes as a static image.
   `web-process-terminated` reloads after 1s; `load-failed` retries with
   backoff (3s, then 15s after 5 consecutive failures). If crashes recur,
   try `--webkit-no-dmabuf`.
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
10. While shown, a 300ms tick oscillates view opacity 1↔0.999 + requests a
    PAINT phase, and each show injects a permanent sub-visible CSS animation
    (`roxysu-keepalive`) so WebKit produces fresh frames continuously —
    forcing real buffer churn so live HUD updates recompose above fullscreen
    games instead of freezing until remap. `--debug` prints paints-per-5s:
    high paints + frozen screen = compositor-side culling; zero paints =
    frame-clock starvation. `--gsk-renderer` / `--webkit-no-dmabuf` exist to
    A/B the GTK/WebKit rendering paths when updates stall on niri.
11. Focus tracking uses its own Wayland event queue + GSource on the GDK
   connection; protocol C code is generated at build time by wayland-scanner
   from wlr-protocols into `apps/overlay/gen/` (gitignored).
12. **Desktop bundling** (NixOS packages): `nix/overlay.nix` builds the host as
   a self-contained derivation (autoPatchelf bakes GTK4/WebKitGTK RPATHs into
   the binary); `nix/prebuilt.nix` / `nix/package.nix` symlink it to
   `resources/overlay/roxysu-overlay`. The Electron shell (`spawnOverlayHost`
   in `apps/desktop/main.js`) spawns it after server readiness — Linux +
   Wayland session only, skipped with a log line otherwise. Override/dev
   path: `ROXYSU_OVERLAY_BIN` or a locally built `apps/overlay/roxysu-overlay`.
   Data rules unchanged: HTTP-only consumer.
13. **Arg form**: the host pre-splits every argv token on `=` into
   `--key value`, so values containing `=` must be passed as a single
   `--key=value` token. Electron passes `--url=http://…?bg=clear`; passing
   the URL as a separate argv value breaks parsing (`unknown option 'clear'`).
14. **Host URL setting**: `settings` key `overlay.host_url` holds the full HUD
   URL (Settings page → In-game overlay section). Missing/empty → default
   `#/overlay?bg=clear`; non-http(s) values are rejected by the PATCH handler.
   **Enable toggle**: `settings` key `overlay.host_enabled` (`"1"`/`"0"`,
   missing = enabled) turns the host off entirely — the Electron shell stops
   the child and suppresses the liveness respawn while off.
   The Electron shell polls `GET /api/settings` (~4s) and applies both keys:
   stop/spawn-restart of the host child whenever they change — plain
   client-app HTTP, no IPC. The same poll is also the liveness respawner: if
   the host child exits on its own (crash or watchdog), it is respawned
   within ~4s, rate-limited to one auto-respawn per 15s
   (`OVERLAY_RESPAWN_GAP_MS`) so a crashing binary cannot spin the poll.
   Settings-change restarts bypass that gap.
15. **Resource watchdog**: the host self-terminates before driver state
   degrades. Every 20s it sums RSS over its process tree (WebKit children)
   and takes the max open-fd count; measured on NVIDIA 595.84 + WebKitGTK,
   continuous frame churn leaks ~8 fds/min and tens of MB/min until the
   kernel floods with `NVRM: can't alloc VA space` (~18 min in) and every
   frame degrades into noise — see rule 10's churn requirement for why the
   churn exists. Caps (env-overridable): tree age > 1800s
   (`ROXYSU_WATCHDOG_MAX_AGE_SEC`), descendant fds > 450
   (`ROXYSU_WATCHDOG_MAX_FDS`), tree RSS > 4200MB
   (`ROXYSU_WATCHDOG_MAX_RSS_MB`). On breach the host logs
   `watchdog: … exiting for clean respawn` and exits 0; the desktop poll
   respawns it fresh within ~4s (rule 14). Restart cost: a ~1s HUD blink;
   alternative cost: system-wide GPU allocation failure cascade.

## Main flow

```
apps/overlay (C: GTK4 + gtk4-layer-shell + WebKitGTK 6)
    │  loads http://127.0.0.1:<port>/#/overlay?limit=N&bg=clear
    ▼
client app server → GET /api/overlay (live session / recent scores)
```

Launch paths:
- Standalone: `nix develop` → `./apps/overlay/build.sh` → `./roxysu-overlay`
- NixOS desktop package: bundled by the flake, spawned automatically by
  `apps/desktop/main.js` (see business rule 12)

(flags: `--url --anchor --margin --width --height --opacity --output
--match-app-id --follow-focus --list-windows`; values with `=` must use
`--key=value` form — rule 13).

## Important symbols

- `apps/overlay/main.c` — host entry point
- `nix/overlay.nix` — self-contained host derivation (`nix build .#roxysu-overlay`)
- `apps/server/public/features/overlay/OverlayPage.tsx` — rendered HUD page
- `apps/server/src/routes/overlay.ts` — `/api/overlay`

## Dependencies

- [dashboard/](dashboard/index.md) — owns the `/api/overlay` endpoint
- [tosu-live/](tosu-live/index.md) — live-session detection behind that payload
- [desktop/](../desktop/index.md) — spawns the bundled host on NixOS packages
- external: wlr-layer-shell compositor, WebKitGTK

## Depended on by

- (entry surface; nothing depends on this feature)

## Related knowledge

- [vocabulary.md](../vocabulary.md) — In-game overlay
- [features/overlay-editor/](../overlay-editor/index.md) — profiles behind `?profile=` URLs
- [architecture/process-model.md](../architecture/process-model.md) — sibling process model
