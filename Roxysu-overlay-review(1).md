# Roxysu Rust overlay host (`apps/overlay-rs`) — in-depth issue analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**App version:** `0.1.23`  
**Overlay crate:** `roxysu-overlay` 0.1.0, binary `roxysu-overlay-rs` (packaged as `roxysu-overlay`)  
**Review date:** 2026-11-17  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo). `master` was not modified.

This document is the overlay-host counterpart of the desktop / UI / logic / server / hub reviews. It focuses on the Wayland overlay in `apps/overlay-rs`, how `apps/desktop/main.js` spawns and polls it, and the three problems reported on KDE Plasma vs niri: wrong monitor, failure to hide when osu! is not focused or is hidden, and a possible memory leak. Suggested patches are proposals only.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. The crate layout, CLI defaults, focus protocol, layer-shell setup, desktop spawn argv, and HUD polling were checked end-to-end. Protocol and compositor behaviour that the code depends on was checked against current public documentation (cited in each section), not against a running Plasma or niri session on this machine.

**Not verified (do not treat these as runtime measurements):**

- The overlay binary was not built or run. This review box has `rustc`/`cargo` 1.85.1 (matches the crate’s `rust-version`) and a GTK 4 runtime (`libgtk-4-1` 4.18.6), but not `pkg-config`, GTK/WebKit development headers, or `gtk4-layer-shell`. A headless Wayland compositor was not available, so no RSS soak, no `WAYLAND_DEBUG` trace, and no on-screen hide/show test was performed.
- KDE Plasma / KWin and niri were not running here. The Plasma vs niri explanations combine the source with KWin and niri source/docs (layer-shell output assignment, foreign-toplevel support tables, KWin’s privileged-interface check).
- No live osu!lazer window was inspected, so actual Plasma `app_id` / XWayland `WM_CLASS` / `resource_name` values are called out as a test risk, not as a measured fact.
- WebKitGTK memory growth over a long session was not measured. Phase 0 of the C host recorded a ~5 minute idle sample on niri (tree RSS roughly flat around 650 MiB) and explicitly skipped a long soak. Phase 8 still lists “long-session telemetry; no orphan WebKit / unexplained growth” as an unchecked manual residual. This review therefore does **not** claim a confirmed unbounded leak in the Rust host; it explains what the code can and cannot contain, and why Plasma makes high/steady RAM more visible.

**Already in good shape (do not re-fix):** context of a sibling surface rather than injection into lazer; layer `OVERLAY` + `exclusive_zone = -1` + keyboard `NONE`; click-through via an empty GDK input region, reapplied on every `map`; URL validation; single-slot WebKit reload backoff; focus visibility evaluated once per Wayland dispatch batch, with hide hysteresis; watchdog exit 75 (so desktop liveness respawn can work); W1–W5 force-present hacks off by default; page-ready gate so a newly mapped WebKit view does not flash opaque grey over the playfield.

---

## Summary table

| ID | Severity | Title | Primary file | Effort |
|----|----------|-------|--------------|--------|
| H1 | High | Follow-focus is `zwlr_foreign_toplevel_manager_v1` only; on Plasma the protocol is missing so the host falls back to always-visible and never hides | `apps/overlay-rs/src/focus/wayland.rs`, `overlay.rs` | Medium–large (1–2 days): Plasma backend + `.desktop` grant + tests |
| H2 | High | Layer surface is created with no `wl_output`; KWin places it on `activeOutput()` (the Roxysu monitor). niri “works” because the surface is first mapped while osu! is focused | `apps/overlay-rs/src/overlay.rs` | Medium (half–1 day) once H1 can see osu!’s output; small if only a manual `--output` setting is added |
| M3 | Medium | No confirmed Rust leak; WebKit is a ~650 MiB baseline, the watchdog cap is 4200 MiB and ignores host RSS, and the desktop disables the age cap. On Plasma the surface also stays mapped forever | `apps/overlay-rs/src/watchdog/`, `apps/desktop/main.js` | Small for caps / telemetry; large if a real WebKit soak finds growth |
| M4 | Medium | `output_enter` / window geometry are ignored, so the overlay does not follow osu! to another monitor even on niri | `apps/overlay-rs/src/focus/wayland.rs`, `overlay.rs` | Medium; land with H2 |
| M5 | Medium | Match policy never consults `title` (or Plasma `resource_name`) when `app_id` is non-empty — a risk for XWayland osu! | `apps/overlay-rs/src/focus/matching.rs` | Small (1–2 h) + device check |
| M6 | Medium | Reducer only looks at “activated”; minimized / other-desktop / other-activity are not first-class hide conditions | `apps/overlay-rs/src/focus/reducer.rs` | Small–medium |
| M7 | Medium | Desktop spawn and Settings UI never pass `--output` (or anchor / size / match) | `apps/desktop/main.js`, `OverlayHostSection.tsx` | Medium (settings + poll + spawn) |
| M8 | Medium | Default path never reasserts the overlay layer on show; after H1 is fixed, hide→show over fullscreen osu! on KWin may fail the same way F-039 did on niri | `apps/overlay-rs/src/diagnostics.rs`, `overlay.rs` | Small to enable a throttled reassert; needs a Plasma fullscreen test |
| L1 | Low | Dev `run.sh` hardcodes `--output=DP-4` | `apps/overlay-rs/run.sh` | Tiny |
| L2 | Low | Default surface is 1920×1090 (larger than 1080p) — a full-monitor WebKit view for a corner HUD | `apps/overlay-rs/src/config.rs` | Small to document / optionally shrink; product decision |
| L3 | Low | Focus command channel is unbounded | `apps/overlay-rs/src/overlay.rs` | Tiny |
| L4 | Low | Focus thread is never stopped or joined on GTK shutdown | `apps/overlay-rs/src/main.rs`, `overlay.rs` | Small |
| L5 | Low | Docs and the layer-shell error claim KDE is supported; focus is not | `apps/overlay-rs/src/main.rs`, `knowledge/features/in-game-overlay/index.md` | Tiny (after H1) |
| L6 | Low | Default `contains` / `osu` can match unrelated `app_id`s | `apps/overlay-rs/src/focus/matching.rs` | Already documented; optional tighter default |
| L7 | Low | `--list-windows` can only talk to wlr-foreign-toplevel, so it is useless on Plasma | `apps/overlay-rs/src/focus/wayland.rs` | Small once H1’s backend exists |
| L8 | Low | In-game overlay settings only expose enable + HUD URL | `OverlayHostSection.tsx` | Fold into M7 |

---

## App structure

Roxysu’s in-game overlay is a **sibling Wayland process**, not a hook inside osu!lazer. The Electron desktop app optionally spawns it; the host draws the existing `/overlay` HUD (the same page OBS uses as a browser source) on the compositor’s `overlay` layer.

It is **not** a winit, wry, or smithay-client-toolkit application. The windowing stack is GTK 4 + gtk4-layer-shell + WebKitGTK 6, with a second raw `wayland-client` connection only for focus tracking.

```
osu!lazer (native Wayland or XWayland)
        ▲
        │  compositor composites the overlay layer above the playfield
        │
apps/overlay-rs  (GTK4 ApplicationWindow, zwlr_layer_shell_v1)
        │  WebKitGTK 6 loads http://127.0.0.1:4321/#/overlay?bg=clear…
        │  focus thread: zwlr_foreign_toplevel_manager_v1  (niri / sway / Hyprland)
        │                — no KWin / Plasma backend today —
        ▼
apps/server  GET /api/overlay  (+ optional tosu live / SSE)
        ▲
apps/desktop/main.js  polls GET /api/settings every 4s
                      spawn: roxysu-overlay-rs --url=… --watchdog-max-age-sec=0
```

| Piece | Role |
|-------|------|
| `apps/overlay-rs/src/main.rs` | GTK `Application` (`NON_UNIQUE`), Wayland / layer-shell preflight, telemetry + watchdog start, shutdown holds |
| `apps/overlay-rs/src/cli.rs`, `config.rs` | clap CLI; defaults; URL / size / opacity / watchdog validation |
| `apps/overlay-rs/src/overlay.rs` | Layer-shell window, WebKit view, page-ready gate, focus command loop, hide hysteresis, `--output` pin (only when set) |
| `apps/overlay-rs/src/focus/wayland.rs` | Dedicated Wayland connection thread; **only** `zwlr_foreign_toplevel_manager_v1` |
| `apps/overlay-rs/src/focus/reducer.rs` | Pure Show/Hide machine, flushed once per dispatch batch |
| `apps/overlay-rs/src/focus/matching.rs` | `contains` (default) / `exact`; `app_id` preferred, `title` only if `app_id` is empty |
| `apps/overlay-rs/src/click_through.rs` | Empty Cairo input region on `map` |
| `apps/overlay-rs/src/reload.rs` | Single-slot WebKit reload / backoff |
| `apps/overlay-rs/src/present.rs` | `should_map_overlay(wants_visible, page_ready)` |
| `apps/overlay-rs/src/diagnostics.rs` | Optional W1–W5 workarounds (off by default) |
| `apps/overlay-rs/src/watchdog/` | 20 s scan; descendant RSS / FD caps; exit 75 after 3 breaches |
| `apps/overlay-rs/src/telemetry/` | Observation-only RSS/PSS/cgroup sampler (off unless flagged) |
| `apps/desktop/main.js` `spawnOverlayHost` / `watchOverlayHostSetting` | 4 s settings poll; spawn/stop/respawn; **only** `--url=` and `--watchdog-max-age-sec=0` |
| `apps/server/public/features/overlay/OverlayPage.tsx` | HUD: React Query poll 4 s live / 15 s idle; optional tosu snapshot |
| `nix/overlay-rs.nix` | Packaged `resources/overlay/roxysu-overlay` |

**Crate / protocol map (what is actually used):**

| Dependency | Used for |
|------------|----------|
| `gtk4` 0.11 (v4_14), `gdk4` 0.11 | Window, monitors, input region, CSS |
| `gtk4-layer-shell` 0.8 (v1_3) | `zwlr_layer_shell_v1`: layer, anchors, exclusive zone, optional `set_monitor` |
| `webkit6` 0.6 | HUD WebView (WebKitGTK 6) |
| `wayland-client` 0.31 + `wayland-protocols-wlr` 0.3 | Second connection for `zwlr_foreign_toplevel_manager_v1` only |
| `async-channel`, `glib` | Focus commands posted onto the GTK main context |
| `cairo-rs` | Empty input region |
| `clap`, `anyhow`, `tracing` | CLI / errors / logs |
| **Not used** | winit, wry, tao, smithay-client-toolkit, x11rb, zbus, `wayland-protocols-plasma` |

**Compositor contracts that matter:**

| Protocol / API | niri 26.04 | KWin 6.7 (Plasma Wayland) |
|----------------|------------|---------------------------|
| `zwlr_layer_shell_v1` | yes — overlay can appear | yes — overlay can appear |
| `zwlr_foreign_toplevel_manager_v1` | **v3** | **not implemented** (`x` on [wayland.app](https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1); KDE bug [502647](https://bugs.kde.org/show_bug.cgi?id=502647) is RESOLVED INTENTIONAL) |
| `ext-foreign-toplevel-list-v1` | yes (typical) | yes as of KWin 6.7, but **no activation / minimized state** — not enough for follow-focus |
| `org_kde_plasma_window_management` | no | yes, and this is the official replacement; it is a **privileged** global |
| niri IPC / KWin scripting / X11 | not used | not used |

Layer-shell with a NULL `wl_output` is “compositor’s choice.” Both niri and KWin implement that as **the currently active output** at the moment the layer surface is created:

- KWin: `LayerShellV1Integration::createWindow` uses `shellSurface->output() ? … : workspace()->activeOutput()` ([`layershellv1integration.cpp`](https://lxr.kde.org/source/plasma/kwin/src/layershellv1integration.cpp)). `activeOutput()` follows the most recent pointer/touch/tablet input and the active window.
- niri: `new_layer_surface` uses the given `wl_output`, or else `monitor_set.active_output()` ([initial layer-shell implementation](https://git.joshthomas.dev/mirrors/niri/commit/37cbed890f86ba148717b2e85a75337a17bd0167); the protocol text says the same: “generally this will be the one that the user most recently interacted with,” [wlr-layer-shell](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)).

That single fact, plus “when is the surface first mapped?”, is the monitor bug.

---

## How the desktop app starts and polls the host

`watchOverlayHostSetting` in `apps/desktop/main.js` runs only on Linux when `WAYLAND_DISPLAY` is set and a binary can be resolved (`ROXYSU_OVERLAY_BIN`, then packaged `resources/overlay/roxysu-overlay`, then a local `target/{release,debug}/roxysu-overlay-rs`). It immediately calls `apply()`, then polls every **4 s**.

Each tick GETs `/api/settings`, reads `overlay.enabled` and `overlay.hostUrl`, and hands the snapshot to `decideOverlayApply` (`overlayApplyPolicy.js`). The host is spawned, stopped, or left alone. Liveness respawn after an exit (including watchdog exit 75) is rate-limited by `OVERLAY_RESPAWN_GAP_MS` (15 s).

The spawn argv is deliberately tiny:

```475:479:apps/desktop/main.js
  overlayChild = spawn(bin, [urlArg, "--watchdog-max-age-sec=0"], {
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    shell: false,
  });
```

So a packaged session always runs with:

- `--url=http://127.0.0.1:<port>/#/overlay?bg=clear` (or the saved `overlay.hostUrl`)
- `--watchdog-max-age-sec=0` (the 30-minute recycle is off, on purpose: a mid-map restart would flash the HUD)
- **no** `--output`, **no** `--follow-focus` (defaults to true), **no** `--width` / `--height` / `--anchor` / `--match-app-id`
- default size 1920×1090, match needle `osu`, `contains` mode, 80 ms hide hysteresis, watchdog RSS cap 4200 MiB

The Settings UI (`OverlayHostSection.tsx`) only exposes the enable toggle and the HUD URL. Changing the URL restarts the host on the next poll.

Dev `apps/overlay-rs/run.sh` is different: it **hardcodes** `--output=${ROXYSU_OVERLAY_OUTPUT:-DP-4}` (the author’s ZOWIE / osu! monitor from the Phase 0 notes). That is one reason a developer on niri can believe “monitor placement just works” even when Electron is not passing `--output`.

---

## Recommended fix order

H1 and H2 are the same work: a Plasma-capable focus backend that also reports which output osu! is on, plus a pin via `set_monitor`. Do not ship “always-visible” as the Plasma fallback — that is what makes both user-facing bugs show up together.

1. **H1 + H2 + M4 + M5 + M6** — one PR: pluggable focus backends (keep wlr-foreign-toplevel; add `org_kde_plasma_window_management`), install/authorize a `.desktop` file, pin the layer surface to the matched window’s output, treat minimized / other-desktop as hide, and loosen matching so a non-empty but non-osu `app_id` can still hit the title. This is the user-visible Plasma fix.
2. **M8** — on show, throttled layer reassert (the old W3 path, or a slimmer always-on variant). Test hide→show over fullscreen osu! on Plasma *and* niri before calling H1 done.
3. **M7 + L8 + L1** — Settings field (or at least a documented env) for `--output`, and stop hardcoding `DP-4` in `run.sh`. Useful even before the auto-pin is perfect, and as a manual override.
4. **M3 + L2 + L3 + L4** — tighten watchdog (include host RSS, lower the cap), bound the focus channel, stop the focus thread on shutdown, optionally shrink the default surface. Turn on `--telemetry-interval-sec` for a real soak on both compositors before chasing a WebKit leak.
5. **L5 + L7** — docs, `--list-windows`, and the “KDE is supported” error string, once the backend exists.
6. **L6** — only if false-positive matches show up in the wild.

---

## H1 — On Plasma the overlay does not hide when osu! loses focus or is hidden

**Severity:** High (the follow-focus feature is the default, and it is a no-op on the most common desktop compositor the docs already list as supported)

### Where

Focus tracking is a dedicated Wayland connection on a background thread. The only global it binds is `zwlr_foreign_toplevel_manager_v1`:

```112:115:apps/overlay-rs/src/focus/wayland.rs
    let _manager: ZwlrForeignToplevelManagerV1 = match globals.bind(&qh, 1..=3, ()) {
        Ok(m) => m,
        Err(_) => bail!("compositor lacks zwlr_foreign_toplevel_manager_v1"),
    };
```

If that first bind fails, `run_focus_loop` sends `FocusCommand::Unavailable` and gives up (no other backend is tried):

```91:93:apps/overlay-rs/src/focus/wayland.rs
            Err(err) if first => {
                let _ = cmd_tx.send_blocking(FocusCommand::Unavailable);
                return Err(err);
            }
```

The GTK side treats that as “behave like `--follow-focus false`”:

```343:353:apps/overlay-rs/src/overlay.rs
                    FocusCommand::Unavailable => {
                        warn!(
                            "foreign-toplevel unavailable; falling back to always-visible \
                             (same as --follow-focus false)"
                        );
                        hide_epoch.set(hide_epoch.get().wrapping_add(1));
                        if *last.borrow() != Some(true) {
                            gate.wants_visible.set(true);
                            sync_gate(&gate);
                            *last.borrow_mut() = Some(true);
                        }
                    }
```

After that, nothing ever sets `wants_visible` back to false. Hide, alt-tab, minimize, and “osu! is on another desktop” cannot unmap the surface.

The reducer, even when the protocol is present, only looks at the **Activated** bit. `Minimized` (wlr state value 1) is parsed as “not activated” only by coincidence: the code walks 4-byte chunks and checks equality with `State::Activated`. It never records minimized, fullscreen, or output membership:

```218:226:apps/overlay-rs/src/focus/wayland.rs
            Event::State { state: states } => {
                let activated = states.chunks_exact(4).any(|chunk| {
                    let v = u32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    v == (zwlr_foreign_toplevel_handle_v1::State::Activated as u32)
                });
                session
                    .reducer
                    .apply(ToplevelEvent::State { id, activated });
            }
```

`output_enter` / `output_leave` / `parent` fall through to `_ => {}`.

### What happens, step by step, on Plasma

1. The user enables the overlay in Roxysu Settings. Electron spawns `roxysu-overlay-rs --url=… --watchdog-max-age-sec=0` with `follow_focus` left at its default `true`.
2. The host opens a second Wayland connection and tries to bind `zwlr_foreign_toplevel_manager_v1`.
3. KWin does not implement that protocol. This is intentional, not a lagging port: [wayland.app’s compositor table](https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1) lists **KWin 6.7 as `x`**, and **niri 26.04 as version 3**. KWin developers closed “please implement wlr-foreign-toplevel” as RESOLVED INTENTIONAL on 2025-12-10 and pointed at `org_kde_plasma_window_management` instead ([KDE bug 502647](https://bugs.kde.org/show_bug.cgi?id=502647), comment from Vlad Zahorodnii).
4. The focus thread emits `Unavailable`. The overlay logs `foreign-toplevel unavailable; falling back to always-visible` and sets `wants_visible = true`.
5. As soon as the HUD posts a transparent frame (or the 1.5 s fallback fires), `sync_gate` maps the nearly fullscreen layer surface and leaves it mapped.
6. Alt-tab to a browser, minimizing osu!, or hiding osu! does nothing: there is no focus session left to emit `Hide`.

`ext-foreign-toplevel-list-v1`, which KWin 6.7 does advertise, is also not enough on its own: it lists toplevels and identifiers, but it has no activation or minimized state. GNOME/Mutter is in the same boat (`x` for wlr-foreign-toplevel); this review only promises a Plasma backend, but the “try a compositor-specific source, do not always-show” policy would help there too.

### Why it works on niri

niri implements `zwlr_foreign_toplevel_manager_v1` v3. The focus loop stays up, the reducer emits `Show` only while a matched window is activated, and `Hide` is applied after the 80 ms hysteresis (cancelled if focus returns). Minimizing or switching away from osu! typically also clears Activated, so the overlay unmaps. That matches the report: hide works on niri, not on Plasma.

### Impact

On Plasma the overlay is a permanent, click-through, nearly fullscreen layer over whichever monitor KWin assigned (see H2). It covers the desktop after the user leaves osu!, and it keeps WebKit/GSK compositing a 1920×1090 transparent surface even when the player is in a browser or the game is minimized. That is both a UX bug and a large part of the “it feels like a leak / it never goes away” report.

### How to reproduce (Plasma)

1. Two monitors, Roxysu on A, osu!lazer on B (or even a single monitor).
2. Enable In-game overlay in Roxysu Settings. Confirm the host is running (`pgrep -a roxysu-overlay`).
3. Look at the overlay log (`…/overlay.log` under the desktop data dir, or stderr in dev). Expect `foreign-toplevel unavailable; falling back to always-visible`.
4. Focus osu!, then alt-tab to another app, then minimize or hide osu!. The HUD stays up.
5. On niri, the same build should log `foreign-toplevel focus loop running…` and `focus: hide` / `focus: show`.

`--list-windows` on Plasma should time out or print `compositor lacks zwlr_foreign_toplevel_manager_v1` (L7).

### Proposed patch

Do not implement wlr-foreign-toplevel inside KWin (they have declined). Add a second backend that speaks KWin’s own protocol, keep the wlr backend for niri/sway/Hyprland, and **stop treating “no protocol” as always-visible**.

#### 1. Make the focus source pluggable; fail closed

Extend commands so a Show can also name an output (used by H2/M4). Change the first-connect failure policy.

```rust
// focus/mod.rs
#[derive(Debug, Clone)]
pub enum FocusCommand {
    Show {
        /// Connector / model / output name, if the backend knows one.
        output: Option<String>,
    },
    Hide,
    Disconnected,
    /// No usable backend. Do *not* auto-show; stay unmapped and keep retrying
    /// (or surface a log + optional --follow-focus-fallback=always flag).
    Unavailable { reason: String },
}
```

Suggested connect order in `run_focus_loop`:

1. Try `zwlr_foreign_toplevel_manager_v1` (niri, sway, Hyprland, river, labwc, …).
2. Try `org_kde_plasma_window_management` (KWin).
3. Optional fallback: a small KWin script over D-Bus (`org.kde.KWin` `/Scripting` `loadScript`) that signals `workspace.windowActivated` to a local socket. Use this only if the privileged Wayland global is not granted. Do not poll `queryWindowInfo` — that API is interactive.
4. If nothing works: log clearly, emit `Unavailable`, **leave `wants_visible` false**, and retry with the existing 1→30 s backoff (authorization can appear after a `.desktop` install). A hidden `--follow-focus-fallback=always` can preserve today’s behaviour for people who want a permanent OBS-like layer.

`FocusCommand::Show` should bump the existing hide-epoch and call `sync_gate` as today, then pin the monitor when `output` is `Some` (H2).

#### 2. Plasma window-management backend

The protocol is documented at [wayland.app/protocols/kde-plasma-window-management](https://wayland.app/protocols/kde-plasma-window-management) and already has a Rust client crate, `wayland-protocols-plasma` (feature `client`). Per-window events that matter:

| Event | Use |
|-------|-----|
| `app_id_changed`, `title_changed`, `resource_name_changed` | matching (M5) |
| `state_changed` bitfield | `Active = 1`, `Minimized = 2`, `Fullscreen = 8`, `OnAllDesktops = 64` |
| `geometry` / `client_geometry` (absolute coords, since v6 / v18) | which GdkMonitor contains the window (H2) |
| `virtual_desktop_entered` / `left`, `activity_entered` / `left` | hide when osu! is not on the current desktop (M6) |
| `unmapped` | same as wlr `closed` |
| `pid_changed` | debug / optional `/proc` confirmation |
| `initial_state` | flush one reducer batch (same role as wlr `done`) |

Feed those into the existing `FocusReducer` (extend `ToplevelInfo` with `minimized` and optional `output` / desktop). Do **not** send `close`, `set_state`, `request_move`, or other controlling requests — observe only.

Sketch of the bind + state handling (new file `focus/plasma.rs`):

```rust
// Cargo.toml
// wayland-protocols-plasma = { version = "0.3", features = ["client"] }

use wayland_protocols_plasma::plasma_window_management::client::{
    org_kde_plasma_window, org_kde_plasma_window_management,
};

const STATE_ACTIVE: u32 = 1;
const STATE_MINIMIZED: u32 = 2;

// In the manager Dispatch:
//   Event::Window { id } | Event::WindowWithUuid { id, uuid } =>
//     get_window / already-created handle, reducer.apply(Added)
// In the window Dispatch:
//   Event::AppIdChanged { app_id } => … AppId { id, app_id }
//   Event::TitleChanged { title } => … Title { id, title }
//   Event::ResourceNameChanged { resource_name } => … also consider as a match haystack
//   Event::StateChanged { flags } => {
//       let activated = flags & STATE_ACTIVE != 0;
//       let minimized = flags & STATE_MINIMIZED != 0;
//       reducer.apply(State { id, activated, minimized });
//   }
//   Event::Geometry { x, y, width, height } => {
//       let cx = x + width as i32 / 2;
//       let cy = y + height as i32 / 2;
//       reducer.apply(Geometry { id, x: cx, y: cy });
//   }
//   Event::Unmapped => reducer.apply(Closed(id))
//   Event::InitialState => { /* batch boundary is still end_batch() after dispatch */ }
```

On the GTK thread, map a geometry point to a monitor with `gdk4::Display::monitors()` and `Monitor::geometry()`, then `window.set_monitor(Some(&monitor))`. Identify monitors by connector/model for logs and for `--output` overrides.

Important: the focus thread uses a **different** `wl_display` than GTK. Never pass a `WlOutput` proxy from that connection into gtk4-layer-shell. Always convert to a name or to global coordinates first, then resolve a `gdk4::Monitor` on the GTK display (this also applies to wlr `output_enter` in M4).

#### 3. KWin will not even advertise the global unless a `.desktop` file grants it

This is the easy-to-miss half of the Plasma backend. KWin treats `org_kde_plasma_window_management` as a privileged interface. On client connect it resolves `/proc/<pid>/exe` and looks for an installed `.desktop` whose `Exec=` canonical path matches that binary and whose `X-KDE-Wayland-Interfaces` lists the protocol ([`serviceutils.h`](https://lxr.kde.org/source/plasma/kwin/src/utils/serviceutils.h); same mechanism discussed in [NixOS #107595](https://github.com/NixOS/nixpkgs/issues/107595) and kdock’s README). If there is no match, KWin logs `Did not grant the interface "org_kde_plasma_window_management"` and the client never sees the global — which would look exactly like today’s “protocol missing” failure.

The Wayland client is **`roxysu-overlay-rs`**, not Electron. The `.desktop` must therefore point at the overlay binary, not at the Roxysu app.

Ship something like `dev.roxysu.overlay.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Roxysu overlay
Comment=In-game HUD host for Roxysu
Exec=/ABS/PATH/TO/roxysu-overlay-rs
NoDisplay=true
StartupNotify=false
X-KDE-Wayland-Interfaces=org_kde_plasma_window_management
```

`Exec` must be the **absolute, canonical** path of the running binary (`std::fs::canonicalize("/proc/self/exe")`). Wrappers break the match (this bit NixOS hard in the past).

Practical approach:

- In `spawnOverlayHost` (or at the start of `main` in the overlay, before the focus connect), write or update `~/.local/share/applications/dev.roxysu.overlay.desktop` with the resolved `Exec=`. Then, if `kbuildsycoca6` is on `PATH`, run it once so KService notices. If the focus connect still fails, the retry loop should pick it up on the next attempt.
- For the Nix package, also install a system `.desktop` whose `Exec` is the store path of `roxysu-overlay`. Store paths change every rebuild, so the runtime write is still needed for dev `target/debug` builds and for unpacked Electron layouts.

Do not start the privileged Wayland connection until that file exists. The existing dedicated-connection design (a second `wl_display`) is fine and is actually the pattern KWin clients use; just do not expect the global to appear without the grant.

#### 4. Optional D-Bus / kdotool-style fallback

If the global is still missing (grant not visible yet, or a future KWin lockdown), a fallback that does **not** need the privileged protocol:

```javascript
// kwin-overlay-watch.js (loaded via org.kde.kwin.Scripting.loadScript)
function report(client) {
    if (!client) { /* send Hide */ return; }
    // caption, resourceClass, resourceName, geometry, output, minimized, desktop
    callDBus("dev.roxysu.Overlay", "/Focus", "dev.roxysu.Overlay.Focus",
             "Update", client.caption, client.resourceClass, /* … */);
}
workspace.windowActivated.connect(report);
report(workspace.activeWindow);
```

This is more fragile (script API changes between Plasma 5/6, `activeClient` vs `activeWindow`, and loading a script is a user-visible privileged action). Treat it as a fallback, not the primary path. `kdotool` itself uses the same Plasma window-management protocol and has the same `.desktop` requirement, so shelling out to it does not avoid the grant problem.

X11 `_NET_ACTIVE_WINDOW` is a last-ditch option only if osu! is confirmed to be an XWayland window, and it will miss a native-Wayland lazer. Do not make it the default.

#### 5. Matching and minimized (land with this PR)

See M5 and M6 for the reducer/policy changes. On Plasma, XWayland osu! may show up as a non-empty `app_id` that does not contain `osu` (for example a generic `dotnet` / toolkit class) with title `osu!` and a useful `resource_name`. Today that window would never match, even after the backend exists.

### Trade-offs

- Privileged interface: the overlay can see every window’s title. Keep the connection read-only, document the grant, and do not log full titles at `info` in default builds if that is a concern.
- The protocol XML still says “only one client can bind this interface at a time.” That text is stale; plasmashell, krunner, and third-party docks bind it together. KWin is the authority here, not the XML warning.
- `.desktop` + canonical `Exec` is brittle on Nix and on unpacked Electron trees. The runtime rewrite of `~/.local/share/applications/…` is the reliable path; test it.
- Failing closed (stay hidden) is a behaviour change for anyone who already relied on the always-visible Plasma fallback. Call it out in the changelog and keep `--follow-focus=false` plus an explicit fallback flag.
- After hide starts working, show-over-fullscreen may regress on KWin (M8). Budget a Plasma test pass.

### How to test

**Plasma (required):**

- Install/write the `.desktop`, restart the host, confirm KWin grants the interface (`journalctl` should *not* say “Did not grant…”) and that `--list-windows` prints osu!.
- Alt-tab away from osu!: overlay hides within ~80–200 ms and does not flicker mid-switch.
- Minimize / hide osu!, or move it to another virtual desktop: overlay hides.
- Close osu! and reopen it: overlay hides, then shows again on activation.
- Run the same tests with osu! as native Wayland and, if you use it, as XWayland. Log `app_id`, `title`, and `resource_name` once.

**niri (regression):**

- Existing follow-focus, hysteresis, and `--list-windows` still work. The wlr backend must remain the one that wins when both would theoretically exist (they will not on niri).

**Negative:**

- On a compositor with neither protocol, the host stays unmapped, logs `Unavailable`, and does not cover the desktop. `--follow-focus=false` still forces always-visible.

---

## H2 — On Plasma the overlay opens on the Roxysu monitor, not the osu! monitor

**Severity:** High (wrong-screen HUD on the exact multi-monitor layout mania players use)

### Where

`set_monitor` is called only when `--output` is passed:

```98:104:apps/overlay-rs/src/overlay.rs
        if let Some(ref name) = config.output {
            let display = gtk4::prelude::WidgetExt::display(&window);
            let monitor = find_monitor_by_name(&display, name)
                .with_context(|| format!("no output matches '{name}'"))?;
            window.set_monitor(Some(&monitor));
            info!(output = %name, "pinned to monitor");
        }
```

`find_monitor_by_name` matches `GdkMonitor::connector()` or `model()` case-insensitively. If `config.output` is `None`, gtk4-layer-shell creates the layer surface with a **NULL** `wl_output`. The compositor then picks an output, and that assignment is sticky until the client sets a monitor or the surface is recreated.

The desktop spawn (see above) never passes `--output`. The Settings UI has no monitor field. Dev `run.sh` does pass `--output=DP-4`, which hides the bug in the author’s niri setup.

### What happens, step by step, on Plasma

1. KWin’s layer-shell integration, when the client passes no output, places the surface on `workspace()->activeOutput()` ([`layershellv1integration.cpp` line 38](https://lxr.kde.org/source/plasma/kwin/src/layershellv1integration.cpp): `Output *output = shellSurface->output() ? shellSurface->output()->handle() : workspace()->activeOutput();`).
2. Because of H1, the Plasma host is always-visible. The page-ready gate maps the window as soon as the HUD’s first transparent frame exists — typically a second or two after spawn, while the user is still in **Roxysu Settings** on monitor A, with the pointer on monitor A.
3. `activeOutput()` is therefore monitor A. The HUD appears over Roxysu, not over osu! on monitor B.
4. Later focusing osu! does not move it: the layer surface is already bound to A, and nothing in the host calls `set_monitor`.

KWin’s `activeOutput()` also follows the pointer. Even after H1 is fixed, if the keyboard focus is on osu! (monitor B) but the mouse is still on A, a NULL-output map can still land on A. That is why “map while osu! is focused and hope” is not a complete fix. The host must pass an explicit `wl_output` (via `gtk_layer_shell_set_monitor`).

### Why it works on niri

niri uses the same rule — NULL output means `active_output()` at surface creation — but the *creation time* is different:

1. Follow-focus works, so `wants_visible` starts false and the GTK window stays unmapped (`set_visible(false)` in `OverlayHost::new`).
2. gtk4-layer-shell typically only commits the layer role when the window is first shown. That first `present()` happens in `sync_gate` on `FocusCommand::Show`, i.e. while osu! is the activated toplevel.
3. niri’s active output at that moment is the osu! monitor, so the HUD appears in the right place.

So niri is not “smarter about osu!.” It just assigns the compositor default at a luckier moment. This is fragile: if the page becomes ready late and the user has already moved the pointer, or if osu! is later dragged to the other monitor (M4), niri can get it wrong too. Phase 8 still has “Multi-monitor `--output`” as an unchecked residual, and the C host’s own help text used to claim “cursor output” when the code passed NULL — the Rust CLI already corrected that wording.

### Impact

On a typical “osu! on the 144 Hz / ZOWIE, Roxysu on the side monitor” desk, the HUD is drawn on the wrong screen and is useless during play. Combined with H1, it also sits on the work monitor after the player tabs out.

### How to reproduce (Plasma)

1. Monitor A: Roxysu. Monitor B: fullscreen or windowed osu!lazer.
2. Enable the overlay from Roxysu (focus and pointer stay on A).
3. The HUD appears on A. Moving the pointer to B or focusing osu! does not move it.
4. On niri, with the same binary and no `--output`, start the host, then focus osu! on B: the HUD should appear on B (current behaviour). Then move osu! to A: the HUD will likely stay on B (M4).

### Proposed patch

Land with H1. Two layers of pin, plus a manual override.

#### 1. Auto-pin from the focus backend

When the reducer decides the matched window is shown, include an output hint:

- **wlr:** handle `output_enter` / `output_leave`. Bind `wl_output` globals on the focus connection and read `name` (v4+) or description/model. Keep a set of outputs per toplevel; if several, prefer the one the window entered most recently, or the one with the largest intersection if you also have geometry.
- **Plasma:** use `geometry` / `client_geometry`. On the GTK thread, pick the `GdkMonitor` whose `geometry()` contains the window centre. Fall back to the monitor with the largest intersection.

```rust
// overlay.rs, in the Show arm (after sync_gate):
FocusCommand::Show { output } => {
    hide_epoch.set(hide_epoch.get().wrapping_add(1));
    if let Some(name) = output.as_deref() {
        pin_to_output(&window, name);
    }
    // … existing show / reassert …
}

fn pin_to_output(window: &ApplicationWindow, name: &str) {
    let display = gtk4::prelude::WidgetExt::display(window);
    if let Some(monitor) = find_monitor_by_name(&display, name) {
        // Skip if already pinned to this monitor to avoid a KWin recreate loop.
        window.set_monitor(Some(&monitor));
        tracing::info!(output = %name, "pinned overlay to osu! output");
    } else {
        tracing::warn!(output = %name, "osu! output not found among Gdk monitors");
    }
}
```

If the user passed `--output`, that wins and auto-pin must not override it.

On KWin, changing the monitor after the surface exists may destroy and recreate the layer window (`recreateWindow` in the same KWin file). Re-apply click-through on the subsequent `map` (already done) and be prepared to bounce the layer (M8). Debounce pins (e.g. only when the resolved monitor actually changes).

#### 2. Manual override in Settings (M7)

Add an optional “Overlay monitor” field (connector name, e.g. `DP-4`, or model, e.g. `ZOWIE XL2546`) stored next to `overlay.hostUrl`. The desktop poll passes `--output=…` when set. This is the escape hatch when auto-pin fails, and it is what the C/Rust hosts already support on the CLI.

A “Follow osu! window” default (auto-pin) plus an explicit name is enough; no need to invent a new protocol.

#### 3. Do not “fix” this by mapping earlier

Mapping the window at startup (even at opacity 0) would make niri behave like Plasma and pin to the Roxysu monitor. Keep the unmapped-until-Show gate.

### Trade-offs

- Auto-pin needs a working focus backend (H1) to know where osu! is. A Settings `--output` can ship first if you need a one-line workaround for testers.
- Multi-output windows (span / during a drag) can flicker if you re-pin on every `output_enter`. Debounce and prefer the output that currently has the larger intersection.
- gtk4-layer-shell `set_monitor` after map is compositor-dependent; test both KWin and niri. If a compositor ignores mid-life changes, unmap, `set_monitor`, then map again (the show path already unmaps on hide).
- Resolving `wl_output` names across two Wayland connections is the usual foot-gun; stick to names / geometry, never raw proxies.

### How to test

**Plasma:** Roxysu on A, osu! on B. Enable overlay, then focus osu!. The HUD must appear on B. Move osu! to A; within a second the HUD must follow. Set an explicit `--output` to B and confirm it stays on B even if Roxysu is focused (once follow-focus maps it). Repeat with the pointer left on A while alt-tabbing to osu! on B — this is the `activeOutput()` trap.

**niri:** same move-osu-across-monitors test (this is new behaviour, M4). Confirm a first map still lands on the osu! output with no `--output` set. Confirm `run.sh` without `DP-4` still works once auto-pin is in.

---

## M3 — Possible memory leak: what the code actually does

**Severity:** Medium (user-reported; not confirmed as an unbounded Rust leak in this commit; containment and Plasma behaviour are real problems)

### Where

Relevant pieces:

- Default layer size 1920×1090 (`config.rs`) — a nearly full-HD WebKit surface, including on a 1080p playfield (the height is even 10 px taller than 1080).
- WebKitGTK 6 loads a React HUD that polls `/api/overlay` every 4 s in live mode and 15 s when idle, plus optional tosu SSE (`OverlayPage.tsx`, `useTosuLiveQuery.ts`). Score lists are capped (≤ 25). No unbounded JS array grew out of a source read.
- Watchdog (`watchdog/policy.rs`, `scan.rs`): every 20 s, descendant-tree RSS and max descendant FDs are compared to **4200 MiB** and **450** FDs. **Host RSS is excluded** (C-compatible). Age cap defaults to 1800 s but the desktop passes `--watchdog-max-age-sec=0`, so a long-lived process is never recycled on a timer. Exit 75 after 3 consecutive breaches; Electron can respawn after 15 s.
- Telemetry sampler exists but is **off** unless `--telemetry-interval-sec` is set. The desktop never enables it.
- Focus channel: `async_channel::unbounded` (`overlay.rs`).
- `PageGate` holds strong references to the window and webview; callbacks hold `Rc<PageGate>`. That is a reference cycle, but it is process-lifetime, not a growing leak.
- Reload is single-slot; diagnostic timers are off by default; keepalive CSS animation is off by default.

Phase 0 (C host, niri, 2026-10-29) measured roughly:

| Phase | Host RSS / PSS | Tree RSS / PSS |
|-------|----------------|----------------|
| startup | 242–248 / 126–129 MiB | ~530 / ~300 MiB |
| idle 5 min | ~260 / ~135 MiB | ~638 / ~357 MiB, **flat** |
| focus-churn / abbreviated gameplay | ~281–282 / ~144–146 MiB | ~655–672 / ~360–378 MiB |

WebKitWebProcess was the largest child. A long soak and a WebKit-kill recovery test were skipped. Phase 8 still has the soak unchecked.

### What is and is not a leak

**Not found in the Rust host:** unbounded buffers that grow with time in the default path, stacked reload timers (the C host had those; the Rust machine does not), listener/timer registration that repeats on every frame, a cache that appends forever, or a thread that accumulates samples. `collect_tree` allocates and drops each watchdog tick. The reducer `HashMap` removes closed toplevels. HUD `knownIds` is replaced with the current score-id set (≤ 25).

**What can look like a leak, especially on Plasma:**

1. **High baseline.** A 1920×1090 transparent WebKitGTK view plus network/web processes and bwrap helpers is already in the 0.5–0.7 GiB tree-RSS range when healthy. That surprises people who expect a tiny HUD.
2. **The surface stays mapped on Plasma** (H1). WebKit/GSK/DMA-BUF keep producing and compositing full-size frames even when the player is in another app. GPU and RSS stay “high and busy.” On niri the surface is unmapped while unfocused, which is both less visible and cheaper.
3. **Weak containment.** A slow WebKit growth (a well-known class of WebKitGTK + DMA-BUF issues, not proven here) can climb to **4.2 GiB of descendant RSS** before the watchdog exits. The host itself could leak without ever tripping the cap. The 30-minute age recycle, which was the blunt instrument for “start a clean WebKit,” is disabled by the desktop because it flashes the HUD mid-play (comment in `main.js` at the spawn site).
4. **Theoretical Rust nits** that will not explain a multi-hundred-megabyte climb: the unbounded focus channel (events are tiny and the GTK loop is usually idle), the un-joined focus thread (reaped on process exit), the `PageGate` cycle (fixed set of objects).

I cannot honestly label a “memory leak in overlay-rs” as confirmed. I *can* say the host is not well armed to detect or recover from a WebKit leak, and that Plasma’s always-visible path makes any growth or high baseline much more obvious.

### Proposed patch

Short-term (do with H1 — this alone will change the Plasma memory picture):

- Unmap when osu! is not focused (H1). Unmapping is already the hide path and is the right way to drop compositor buffers.
- Include **host + descendants** in the RSS cap, or add a separate host cap. Lower the default to something like **2048 MiB tree RSS** (still well above the ~650 MiB healthy baseline; adjust after a soak). Keep the 3-sample window.
- Optionally log a compact RSS line at `info` once a minute when `--debug` is off, so a user report comes with numbers. Or have the desktop pass `--telemetry-interval-sec=30` into a rotating log in the existing overlay log fd.
- Bound the focus channel (`async_channel::bounded(64)`); on overflow, drop `Disconnected`-like noise and keep the latest Show/Hide.

Medium-term, only after a real soak on niri *and* Plasma:

- Run `--telemetry-interval-sec=10 --telemetry-csv=… --watchdog-max-age-sec=0` for 60–120 minutes of gameplay plus idle. If WebKitWebProcess RSS is monotonically climbing, consider a **reload while unmapped** (hide → `load_uri` the same URL → show on next focus) as a safe recycle that does not flash the playfield. Do not bring back a 30-minute *mapped* restart.
- Look at WebKit cache / process-model settings only if the soak points at the web process.
- L2: consider a smaller default surface when the profile is a corner HUD; keep 1920×1090 when the overlay editor’s full stage is in use.

### Trade-offs

- A tighter RSS cap will false-positive on a 4K stage or a machine where WebKit’s baseline is higher (NVIDIA + 2× 1440p, etc.). Make it configurable; the desktop can pass a flag.
- A mapped mid-game restart is worse than high RSS. Any recycle must happen while unmapped, or be user-initiated.
- Extra telemetry I/O is cheap at 30 s; do not sample `smaps_rollup` at 1 s (it is expensive).

### How to test

- **Plasma, before H1:** note tree RSS while the overlay sits on the Roxysu monitor with osu! unfocused — this is the “always on” baseline the user is seeing.
- **Plasma, after H1:** same measurement while unfocused (surface unmapped) vs while playing. Unmapped should drop compositor/GPU memory; RSS may stay in the WebKit process until a reload.
- **niri and Plasma soaks:** 60–120 min with CSV telemetry. Compare startup, 5 min idle, 30 min play, 30 min unfocused. Flat after idle ≈ no leak; a steady climb in `webkit-web` RSS ≈ WebKit issue, not the reducer.
- Force a descendant RSS breach in a debug build (low `--watchdog-max-rss-mb`) and confirm exit 75 and a desktop respawn within one poll window, *while unmapped* if possible.

---

## Other issues

### M4 — Overlay does not follow osu! to another monitor (even on niri)

**Where:** `focus/wayland.rs` ignores `output_enter` / `output_leave`. There is no geometry tracking, and `set_monitor` is never updated after start.

**Impact:** A player who drags osu! to the other screen, or who starts a second lazer window on another output, keeps the HUD on the old one. niri’s “it opened in the right place” only applies to the first map.

**Fix:** Land with H2’s auto-pin. On the wlr backend, bind `wl_output` and translate `output_enter` into a name before crossing to GTK. Unit-test the reducer with “matched window moved from DP-4 to DP-5 → new Show { output }”.

**Test:** niri and Plasma, move a already-focused osu! across monitors; the HUD must follow. `--output=DP-4` must still pin and ignore moves.

### M5 — Title is ignored when `app_id` is non-empty

**Where:**

```68:76:apps/overlay-rs/src/focus/matching.rs
    pub fn matches(&self, app_id: &str, title: &str) -> bool {
        if !app_id.is_empty() {
            return self.match_str(app_id);
        }
        if !title.is_empty() {
            return self.match_str(title);
        }
        false
    }
```

This is inherited from the C host and is tested (`firefox` + title `osu!lazer` → no match). That is reasonable for avoiding random browser tabs, but it is wrong if the **game window itself** has a non-matching `app_id`. On Plasma, XWayland windows often get a toolkit `app_id` / `WM_CLASS` while the title stays `osu!`. Plasma also exposes `resource_name`, which the host never reads.

**Fix:** Keep the “do not match a browser tab titled osu!” property for genuine non-osu app ids that are well-known, or — simpler and better for a game overlay — match if **any** of `app_id`, `title`, or `resource_name` matches the needle, and add a `--match-mode app-id-only` for the old behaviour. Document that `exact` plus a specific id (`sh.ppy.osu-lazer`, `osu!`) is the tight path.

```rust
pub fn matches(&self, app_id: &str, title: &str, resource_name: &str) -> bool {
    [app_id, title, resource_name]
        .into_iter()
        .any(|s| !s.is_empty() && self.match_str(s))
}
```

**Test:** `--list-windows` on Plasma with both native Wayland and XWayland lazer; confirm a Show happens without having to guess the class. Add a unit test: `app_id="dotnet"`, `title="osu!"` → match under the new policy.

### M6 — Minimized / other desktop are not first-class hide conditions

**Where:** `FocusReducer` only computes `match_focused = any(matched && activated)`. On wlr, minimized usually also clears Activated, so niri hide-on-minimize works in practice. On Plasma, `state` is a bitfield: a window can be `Minimized` and the Active bit is not a substitute for “is this window visible to the user.” Virtual desktops and activities are separate events.

The user report specifically includes “hiding osu!.”

**Fix:** Extend `ToplevelInfo` with `minimized: bool` and `on_current_desktop: bool` (default true on compositors that do not tell us).

```rust
// end_batch:
if self.policy.matches(&tl.app_id, &tl.title, &tl.resource_name)
    && tl.activated
    && !tl.minimized
    && tl.on_current_desktop
{
    match_focused = true;
}
```

**Test:** Plasma: minimize osu!, switch desktop, switch back. niri: minimize if the compositor supports it; moving osu! off the focused workspace should still Hide via Activated, and must not regress.

### M7 — Desktop and Settings never pass `--output` (or other host flags)

**Where:** `spawnOverlayHost` argv; `GET/PATCH /api/settings` overlay object; `OverlayHostSection.tsx`. Only `enabled` and `hostUrl` exist.

**Impact:** The one override that already works around H2 (and that every internal dev note tells you to use) is unreachable from the packaged app. Anchor, size, and match needle are also stuck at defaults.

**Fix:** Extend the settings overlay object with optional `output`, `anchor`, `width`, `height`, `matchAppId`. Validate like the URL (non-empty; output is a string). `spawnOverlayHost` builds argv from the last successful poll. Keep omitting a flag when the value is default so older binaries do not break if a user downgrades. L8 is the UI half of this.

**Test:** Save `output=DP-4`, confirm the next poll restarts the host with `--output=DP-4` and that the HUD is on that connector (debug log `pinned to monitor`). Clear the field and confirm auto-pin (H2) resumes.

### M8 — After hide works, show over fullscreen osu! on KWin may need a layer reassert

**Where:** `diagnostics::on_show` only calls `reassert_placement` when `--diag-reassert-placement` is on (default off). F-039 documented the same class of bug on the C host: after `set_visible(false)`, a later `present()` may not put a layer-shell surface back above fullscreen osu!. The Rust show path does call `set_visible(true)` then `present()`, which is the F-039 fix, but the TOP→OVERLAY bounce is still opt-in.

**Impact:** Once H1 lands, a Plasma user may report “it hides, but it does not come back over fullscreen lazer.” That would look like a new bug.

**Fix:** On every transition from unmapped → mapped, do a throttled layer reassert (TOP then OVERLAY, re-apply anchors), not only when the diagnostic flag is set. Keep the 1 s throttle in `on_refocus_while_shown` so a noisy focus stream cannot bounce the layer every event. Verify this does not flicker on niri.

**Test:** Plasma and niri, fullscreen osu!, alt-tab away and back several times. The HUD must reappear above the playfield every time, with click-through still applied (`connect_map` already re-applies it).

### L1 — `run.sh` hardcodes `--output=DP-4`

```5:6:apps/overlay-rs/run.sh
cargo build
exec ./target/debug/roxysu-overlay-rs --output="${ROXYSU_OVERLAY_OUTPUT:-DP-4}" "$@"
```

Fine on the author’s desk, surprising everywhere else (`no output matches 'DP-4'` if that connector does not exist — and that error is fatal in `OverlayHost::new`). Default to unset (compositor / auto-pin) and only apply `ROXYSU_OVERLAY_OUTPUT` when the env is set.

### L2 — Default 1920×1090 WebKit surface

Inherited from the C host so the overlay-editor stage can be 1:1 with a 1080p playfield. Cost: a full-monitor GPU buffer for what is often a corner widget, and 1090 > 1080. After auto-pin, consider sizing to the chosen monitor’s geometry, or to the profile’s bounding box plus padding. Document why the default is so large if you keep it.

### L3 — Unbounded focus channel

`async_channel::unbounded::<FocusCommand>()` in `start_focus_tracking`. A stuck GTK loop could queue commands without bound. A small bounded channel plus “keep the latest Show/Hide” is enough. Not a realistic explanation for a GMsized leak.

### L4 — Focus thread is not stopped on shutdown

`main.rs` stops the watchdog and the telemetry sampler on `connect_shutdown`, then drops the application hold. The focus thread is a detached `std::thread` in an infinite reconnect loop; it is only reaped when the process exits. Give it an `AtomicBool` / drop the channel and join, like `WatchdogHandle`, so SIGTERM is clean and a future “reload focus” path cannot leave a second session running.

### L5 — Docs claim KDE support

`run_app`’s layer-shell error says “Hyprland, sway, niri, river, KDE.” The knowledge page (`knowledge/features/in-game-overlay/index.md`) lists KDE the same way, and rule 7 describes only `zwlr_foreign_toplevel_management`. After H1, update the knowledge page with the Plasma backend, the `.desktop` grant, and the fail-closed policy. Until then, the string over-promises.

### L6 — `contains` + needle `osu` can false-positive

Already unit-tested (`bosun`). Unlikely in a games-desktop context, but `--match-mode exact` plus a recorded app_id is the safe setting. Optional: a small built-in allow-list (`osu!`, `osu!lazer`, `sh.ppy.osu-lazer`) as the default mode.

### L7 — `--list-windows` is wlr-only

On Plasma it fails the same bind as H1 and is the obvious diagnostic for “why is follow-focus dead?” After the pluggable backend exists, `run_list_windows` should try Plasma too and print `app_id`, `title`, `resource_name`, states, and geometry/output.

### L8 — Settings UI is enable + URL only

Fold into M7. Until then, a tester’s only Plasma workaround is to run the host by hand with `--output=…` (or set `ROXYSU_OVERLAY_BIN` and wrap it).

---

## Suggested combined implementation sketch (H1+H2+M4+M5+M6)

This is the shape of the PR, not a commit. Leave `master` untouched until you choose to apply it on a branch.

**Files to add/change:**

- `apps/overlay-rs/Cargo.toml` — add `wayland-protocols-plasma` (client).
- `apps/overlay-rs/src/focus/mod.rs` — new `FocusCommand::Show { output }`, `Unavailable { reason }`.
- `apps/overlay-rs/src/focus/plasma.rs` — new backend (dispatch, geometry, states).
- `apps/overlay-rs/src/focus/wayland.rs` — handle `output_enter`/`leave` + minimized; first-connect becomes “try wlr, else return a typed error,” not the only path.
- `apps/overlay-rs/src/focus/backend.rs` (new) — `run_focus_loop` tries wlr, then Plasma, then optional D-Bus; fail closed.
- `apps/overlay-rs/src/focus/matching.rs` + `reducer.rs` — any-of matching; minimized / desktop flags; output hint on Show.
- `apps/overlay-rs/src/overlay.rs` — pin on Show; fail closed on Unavailable; bounded channel; click-through already on map.
- `apps/overlay-rs/src/desktop_grant.rs` (new) — write `~/.local/share/applications/dev.roxysu.overlay.desktop`.
- `apps/desktop/main.js` — optional: write the same grant with the resolved bin path *before* spawn; later M7 argv.
- `nix/overlay-rs.nix` — install the `.desktop` template.
- Tests: reducer output moves; matching `dotnet`+`osu!`; Unavailable does not set `wants_visible`; `should_map_overlay` unchanged.

**Connect / grant order in `main` / `run_app`:**

1. `config.apply_process_env()`
2. Write the `.desktop` grant (best-effort, log errors).
3. GTK activate → create the (still unmapped) layer window, start the focus thread.
4. On `Show { output }`, `set_monitor` then map (page-ready gate unchanged).
5. On `Hide`, unmap as today.
6. On `Unavailable`, log the reason (`wlr missing; plasma global not advertised — is the .desktop grant installed?`) and stay hidden.

---

## Sources cited

- wlr-foreign-toplevel compositor support, including **KWin 6.7: unsupported**, **niri 26.04: v3**: https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1  
- KWin will not implement that protocol; use Plasma window management: https://bugs.kde.org/show_bug.cgi?id=502647  
- Plasma window management protocol (states, geometry, app_id, title, resource_name): https://wayland.app/protocols/kde-plasma-window-management  
- Rust client events / `State::{Active, Minimized, …}`: https://docs.rs/wayland-protocols-plasma  
- KWin layer-shell NULL output → `workspace()->activeOutput()`: https://lxr.kde.org/source/plasma/kwin/src/layershellv1integration.cpp  
- wlr-layer-shell “NULL output = compositor choice / last interaction”: https://wayland.app/protocols/wlr-layer-shell-unstable-v1  
- niri NULL output → `monitor_set.active_output()`: niri layer-shell handler (`new_layer_surface`)  
- KWin privileged-interface grant via `X-KDE-Wayland-Interfaces` and canonical `Exec=` vs `/proc/pid/exe`: https://lxr.kde.org/source/plasma/kwin/src/utils/serviceutils.h — also NixOS #107595 and the kdock README  
- `ext-foreign-toplevel-list-v1` (list only, no activation): https://wayland.app/protocols/ext-foreign-toplevel-list-v1  

---

## Review limits, restated

Nothing in `/workspace/Roxysu` was modified. No PR was opened, and no branch was pushed. The three user-facing Plasma/niri behaviours are explained from source plus the compositor documentation above; they were not reproduced on a live Plasma or niri session in this review environment, and memory was not re-measured beyond the Phase 0 figures already in the repo.
