---
last_verified: 2026-11-23
confidence: verified
touches:
  - apps/overlay-rs/
  - flake.nix
  - nix/overlay-rs.nix
  - nix/prebuilt.nix
  - nix/package.nix
  - apps/desktop/main.js
  - apps/desktop/overlayApplyPolicy.js
  - apps/desktop/overlayApplyLoop.js
  - apps/desktop/overlaySettings.js
  - apps/desktop/overlayUrlGuard.js
  - apps/server/src/routes/settings.ts
  - apps/server/src/routes/overlay.ts
  - apps/server/src/overlay/hostStatus.ts
  - apps/server/src/overlay/hostConfig.ts
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
7. **Focus following** (default on): a second Wayland connection, off the GTK
   thread. Prefer `zwlr_foreign_toplevel_manager_v1` (niri, sway, Hyprland,
   river). If that global is missing, bind read-only
   `org_kde_plasma_window_management` (KWin). The Plasma global is privileged:
   before connect the host writes
   `~/.local/share/applications/dev.roxysu.overlay.desktop` whose `Exec` is the
   canonical overlay binary and whose `X-KDE-Wayland-Interfaces` lists that
   protocol, then runs `kbuildsycoca6` (or `kbuildsycoca5`; also searched in
   `/run/current-system/sw/bin`, `~/.nix-profile/bin`,
   `/etc/profiles/per-user/$USER/bin`, `/usr/bin` — a packaged shell has a
   minimal PATH) when the file changed. The Nix package also installs that
   desktop file for the store path, and the Electron wrapper prefixes
   `kdePackages.kservice` onto PATH so the spawned host can find
   `kbuildsycoca6`. A grant written this run makes the first binds retry
   quickly (5 × 200 ms) before the normal ladder, because KWin's service
   cache may not have picked the entry up yet; a grant that never appears
   stays fail-closed. The host does not send
   close, move, resize, or state-change requests. Show while a matched window
   is activated and not minimized. Match policy is unchanged: `contains` on
   `app_id` (default needle `osu`); title is used only when `app_id` is empty.
   `resource_name` is printed by `--list-windows` — which waits for every
   adopted Plasma window's `InitialState` (or a quiet wlr batch) so the dump
   cannot show half-arrived fields — and is not a match haystack
   (a browser tab titled osu! must not match). On Show, if `--output` is unset,
   pin the layer surface to that window's output (`wl_output` name, or Plasma
   geometry against a `GdkMonitor`). The host does not set `wants_visible`
   before a hint resolves to a monitor (fail-closed placement; a previous
   known pin still counts), and an output change on a live surface is
   unmap → `set_monitor` → remap after a short delay, never `set_monitor` on a
   mapped surface. Outputs advertised after connect are
   bound when the registry announces them (duplicate globals ignored), a
   removed output's name is dropped from every toplevel, and its `wl_output`
   proxy is `release()`d on v3+ before it is dropped. Plasma window proxies are destroyed on
   `Unmapped` and their internal ids released (KWin reuses ids after an
   osu! restart); wlr handles are destroyed on `Closed`. An explicit
   `--output` wins and is not
   overridden. `--match-mode exact` remains. Visibility is evaluated once per
   dispatch batch; Hide uses short hysteresis (`--hide-hysteresis-ms`, default
   80). First-connect failure stays unmapped, logs the reason, and retries
   (quickly after a fresh grant write, then 1 s doubling to 30 s). Later drops
   leave visibility unchanged
   and reconnect. `--follow-focus=false` is the always-visible path. The focus
   thread stops and joins on GTK shutdown.
8. **Self-heal**: `web-process-terminated` recreates the `WebView` (fresh widget and content manager, then reload) after the reload delay, because `load_uri` on the poisoned widget kept its renderer/DMA-BUF state; `load-failed`
   (HUD/server) retries at 3 s / 15 s after >5 failures via a **single-slot**
   reload state machine (no stacked timers). Distinct log lines for load-fail
   vs web-process crash. **Hang probe** (D-NEW-1): every 5 s the host pings
   the web process with a trivial `evaluate_javascript`; a ping unanswered
   for 20 s terminates the process, which runs the same recreate path (a
   hung renderer is not a crash and used to leave a frozen HUD; WebKit's own
   responsiveness check only runs around input, which this click-through
   surface never gets). The script runs on the web process main thread, not
   on a frame callback, so an unmapped HUD still answers. `--webkit-no-dmabuf` / `--gsk-renderer` remain for
   A/B when rendering stalls.
9. Visibility is a hard map/unmap of the layer surface (soft opacity-only hide
   failed historically on Wayland + WebKit). The surface stays unmapped until
    focus wants it and the page has posted a transparent frame (two animation
    frames after load, or a 1.5s fallback). It unmaps again on navigation,
    load failure, and web-process termination so a reload cannot paint
    WebKit's opaque grey clear over the playfield. The first 50ms after map
    stay at opacity 0 to cover that clear when the compositor honors opacity.
10. **Default path does not force redraw.** W1–W5 compositor force-present
    hacks are behind `--diag-*` (and `--debug` implies W4 paint counter).
    WebKit already redraws on HUD content change. `--debug` also reports real
    frame-clock paint counts.
11. Focus tracking runs off the GTK thread and posts Show/Hide to the main
    context over a bounded, coalescing queue (`focus/queue.rs`: one wake slot +
    the newest command). The producer never blocks; if the main loop is busy,
    only the latest visibility state matters.
12. **Desktop bundling**: `nix/overlay-rs.nix` builds the host; packages symlink
    `bin/roxysu-overlay` into `resources/overlay/roxysu-overlay`. Electron
    (`spawnOverlayHost`) uses that path, then local
    `apps/overlay-rs/target/{release,debug}/roxysu-overlay-rs`. Override:
    `ROXYSU_OVERLAY_BIN`. Linux + Wayland only.
13. **CLI**: clap accepts `--url=VALUE` and `--url VALUE` with `=` inside
    values. Electron passes `--url=http://…?bg=clear` and a long
    `--watchdog-max-age-sec` backstop (default 21600 s; `ROXYSU_OVERLAY_MAX_AGE_SEC`
    overrides, `0` disables). `--width`/`--height` are optional: omitted, the
    surface request follows the pinned output's geometry minus the anchored
    `--margin` (fallback 1280×720 before a monitor is known). The surface is
    anchored to one corner, so the compositor uses that size as-is; explicit
    sizes are clamped to the same area on every pin, including a repin to a
    smaller monitor.
14. **Host settings**: `overlay.host_url`, enable toggle `overlay.host_enabled`,
    optional monitor `overlay.host_output` (connector or model), and a
    monotonic restart nonce `overlay.host_restart` written by the settings
    UI's **Restart overlay** button. Electron polls `GET /api/overlay/host-config`
    (4 s, or 10 s while the host is known disabled; ETag / 304) — one
    run in flight, mid-flight ticks coalesce
    (`apps/desktop/overlayApplyLoop.js`) — then stop/spawn/restart,
    liveness respawn starting at `OVERLAY_RESPAWN_GAP_MS` (15 s) and
    doubling to 5 min; after 5 runs shorter than 60 s the host is parked,
    and exit **78** (`apps/overlay-rs/src/lifecycle.rs`
    `UNSUPPORTED_EXIT_CODE`: no Wayland or no wlr-layer-shell) parks it at
    once. The toggle, a URL/monitor change or the restart nonce un-park it.
    A park writes `overlay-host-status.json` (`unsupported` or `crash-loop`);
    Settings reads `GET /api/overlay/host-status` and shows that line.
    The desktop spawns the host with a stdin pipe and
    `--exit-on-stdin-eof`, so it exits when Electron dies. A saved output is
    passed as one `--output=` argument; empty means follow the matched
    window. A URL or monitor change, or an unapplied restart nonce,
    restarts immediately; the shell records the nonce it spawned under, so
    one click restarts exactly once. Decision logic:
    `apps/desktop/overlayApplyPolicy.js:decideOverlayApply()`. A settings
    poll is only trusted for HTTP 200 with an `overlay` object and a
    boolean `enabled`, body capped at 64 KiB
    (`apps/desktop/overlaySettings.js`) — a non-200 error document counts
    as a failed poll (feeding the 5-failure stop rule), never as "enabled
    with the default HUD URL". The shell re-validates `hostUrl`/`output`
    before argv (`apps/desktop/overlayUrlGuard.js`, mirroring the PATCH
    parsers): a rejected URL falls back to the default HUD URL, a rejected
    monitor follows the matched window.
15. **Resource watchdog** (default on): off GTK thread; descendant RSS / max
    descendant FDs / optional age / optional cgroup. Requires
    `--watchdog-breach-samples` consecutive breaches (default 3), then exits
    **75** (not 0) so `Restart=on-failure` / desktop respawn work. Age cap
    disable with `--watchdog-max-age-sec 0`. The desktop shell passes a long
    backstop (default 21600 s = 6 h) instead of the old `0`: the binary
    default (1800s) plus desktop respawn was a clockwork HUD refresh over the
    playfield, while a fully disabled cap let a slow leak run for days. FD and
    RSS caps still recover a leak sooner. **Main-loop stall** (D-NEW-1): the
    GTK main loop stamps a heartbeat every 1 s (`watchdog/heartbeat.rs`); a
    stamp older than `--watchdog-max-stall-sec` (default 30, `0` disables,
    minimum 5) is a breach sample, so a wedged host exits 75 after ~70 s with
    the default 20 s scan × 3 samples and the desktop liveness respawn brings
    it back. Timeouts keep running while the surface is unmapped, so a hidden
    HUD (osu! unfocused) never counts as stalled; the monotonic clock skips
    system suspend.
    Observation-only telemetry via `--telemetry-interval-sec` /
    `--telemetry-csv`.
16. **Surface-contract logs** (info level, always on): surface size and
    widget scale at map, `GdkSurface::layout` (the layer-shell configure as
    GTK sees it), surface enter/leave monitor (connector, model, geometry,
    scale), every pin (from/to key, mapped at the time, target geometry and
    scale), and web-process death with the surface state it died in. These
    lines are the D1 diagnosis set. The behaviour fixes (do not map without a
    placement hint, unmap-before-pin, size-to-output, WebView recreate after a
    web-process crash) are implemented but still need a real Plasma/niri
    soak; match-policy loosening remains gated on a settled `--list-windows`
    dump. `--list-windows` reuses the post-grant fast retries so the first-run
    dump is reliable.

## Security rules

1. The Plasma window-management connection is observe-only. It does not send
   `close`, `set_state`, move, resize, or virtual-desktop requests. The
   `destroy` sent on `Unmapped` releases the client's own
   `org_kde_plasma_window` resource (protocol object teardown), not a
   window-management request.
   **Enforced by:** `apps/overlay-rs/src/focus/plasma.rs` — status: verified
   **Unauthorized result:** those requests are not implemented.

2. The `.desktop` grant lets this binary see other windows' app ids and titles.
   Titles are not written at info. `--list-windows` prints them because the
   operator asked for the dump.
   **Enforced by:** `apps/overlay-rs/src/focus/plasma.rs` (no title `info!`) and
   `apps/overlay-rs/src/focus/grant.rs` — status: verified
   **Unauthorized result:** without the grant KWin does not advertise the
   global, and the host stays unmapped.

3. A missing focus protocol does not map the overlay.
   **Enforced by:** `visibility_after_unavailable` in
   `apps/overlay-rs/src/focus/mod.rs`, applied from
   `FocusCommand::Unavailable` — status: verified
   **Unauthorized result:** the surface stays unmapped. `--follow-focus=false`
   is the explicit always-visible path.

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
- `apps/overlay-rs/src/focus/` — match policy, reducer, wlr + Plasma backends, `.desktop` grant
- `apps/overlay-rs/src/reload.rs` — single-slot reload SM
- `apps/overlay-rs/src/watchdog/` — resource + main-loop stall policy, heartbeat, exit 75
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
