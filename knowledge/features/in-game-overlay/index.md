---
last_verified: 2026-10
confidence: verified
touches:
  - apps/overlay-rs/
  - flake.nix
  - nix/overlay-rs.nix
  - nix/prebuilt.nix
  - nix/package.nix
  - apps/desktop/main.js
  - apps/desktop/overlayApplyPolicy.js
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/settings/sections/OverlayHostSection.tsx
  - packages/db/src/settings-keys.ts
---

# In-game overlay

## Purpose

Standalone Wayland host (`apps/overlay-rs`, binary `roxysu-overlay-rs` /
packaged name `roxysu-overlay`) that draws the existing `/overlay` HUD page
above fullscreen osu!lazer on wlr-layer-shell compositors (Hyprland, sway,
niri, river, KDE). No injection into lazer — a sibling surface on the Wayland
`overlay` layer.

## Business rules

1. Data reaches the HUD **only** through client-app HTTP (`GET /api/overlay`,
   same page as the OBS browser-source route `#/overlay?bg=clear`). The host
   never touches Realm or the local mirror directly.
2. The surface is display-only: always click-through (empty GDK input region)
   and keyboard mode `NONE`. Click-through is reapplied on every `map`.
3. The host paints no background of its own (window + webview forced
   transparent via CSS); all translucency comes from the page's `bg=clear`
   variant.
4. Linux + zwlr_layer_shell_v1 only. On X11 / non-layer-shell compositors it
   exits with guidance to use the same URL as an OBS browser source instead.
5. The host is version-agnostic to lazer; only the compositor contract matters.
6. Layer placement: `OVERLAY` layer, `exclusive_zone = -1`, anchored corner per
   `--anchor`, so panels/fullscreen windows never displace it.
7. **Focus following** (default on): dedicated Wayland connection for
   `zwlr_foreign_toplevel_management`; show only while a matching window is
   activated. Match policy default `contains` (case-insensitive substring of
   `--match-app-id`, default `osu`); title is used only when `app_id` is empty.
   `--match-mode exact` available. Visibility is evaluated once per dispatch
   batch; Hide uses short hysteresis (`--hide-hysteresis-ms`, default 80).
   Missing protocol on first connect → always-visible fallback; later drops
   leave visibility unchanged and reconnect with backoff.
8. **Self-heal**: `web-process-terminated` reloads after 1 s; `load-failed`
   (HUD/server) retries at 3 s / 15 s after >5 failures via a **single-slot**
   reload state machine (no stacked timers). Distinct log lines for load-fail
   vs web-process crash. `--webkit-no-dmabuf` / `--gsk-renderer` remain for
   A/B when rendering stalls.
9. Visibility is a hard map/unmap of the layer surface (soft opacity-only hide
   failed historically on Wayland + WebKit).
10. **Default path does not force redraw.** W1–W5 compositor force-present
    hacks are behind `--diag-*` (and `--debug` implies W4 paint counter).
    WebKit already redraws on HUD content change. `--debug` also reports real
    frame-clock paint counts.
11. Focus tracking runs off the GTK thread and posts Show/Hide to the main
    context over a channel.
12. **Desktop bundling**: `nix/overlay-rs.nix` builds the host; packages symlink
    `bin/roxysu-overlay` into `resources/overlay/roxysu-overlay`. Electron
    (`spawnOverlayHost`) uses that path, then local
    `apps/overlay-rs/target/{release,debug}/roxysu-overlay-rs`. Override:
    `ROXYSU_OVERLAY_BIN`. Linux + Wayland only.
13. **CLI**: clap accepts `--url=VALUE` and `--url VALUE` with `=` inside
    values. Electron still passes `--url=http://…?bg=clear`.
14. **Host URL setting**: `overlay.host_url` / enable toggle `overlay.host_enabled`
    as before — Electron polls settings (~4s), stop/spawn/restart, liveness
    respawn with `OVERLAY_RESPAWN_GAP_MS`. Decision logic:
    `apps/desktop/overlayApplyPolicy.js:decideOverlayApply()`.
15. **Resource watchdog** (default on): off GTK thread; descendant RSS / max
    descendant FDs / optional age / optional cgroup. Requires
    `--watchdog-breach-samples` consecutive breaches (default 3), then exits
    **75** (not 0) so `Restart=on-failure` / desktop respawn work. Age cap
    disable with `--watchdog-max-age-sec 0`. Observation-only telemetry via
    `--telemetry-interval-sec` / `--telemetry-csv`.

## Main flow

```
apps/overlay-rs (GTK4 + gtk4-layer-shell + WebKitGTK 6)
    │  loads http://127.0.0.1:<port>/#/overlay?limit=N&bg=clear
    ▼
client app server → GET /api/overlay (live session / recent scores)
```

Launch paths:
- Dev: `bun run overlay` / `cargo run` under `apps/overlay-rs`
- Nix: `nix build .#roxysu-overlay` → desktop package bundles it
- Desktop: Settings toggle → `spawnOverlayHost`

## Important symbols

- `apps/overlay-rs/src/main.rs` — host entry
- `apps/overlay-rs/src/overlay.rs` — window / WebKit / focus wiring
- `apps/overlay-rs/src/focus/` — match policy + batched reducer + Wayland
- `apps/overlay-rs/src/reload.rs` — single-slot reload SM
- `apps/overlay-rs/src/watchdog/` — resource policy + exit 75
- `nix/overlay-rs.nix` — derivation (`nix build .#roxysu-overlay`)
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
- Migration archive: `findings/overlay-rs-phase*.md`, `findings/overlay-c-phase0-baseline.md`
