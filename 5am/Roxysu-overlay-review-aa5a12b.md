# Roxysu overlay host on `play/rune-migration` @ `aa5a12b` — review and fix plan

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch reviewed:** `play/rune-migration`  
**Commit:** `aa5a12b457630b1fb751fc61d2be8c4331d0228e`  
(“Add overlay settings management and validation for the in-game overlay host”, 2026-11-23 00:54 Europe/Lisbon)  
**Compared against:** `0d845951ffb59bb1b1e8486927f5f965311510a2` (previous overlay review: `/workspace/Roxysu-overlay-review-0d84595.md`)  
**Review date:** 2026-11-23  
**Worktree (read-only):** `/workspace/rx-overlay-aa5a12b` (detached HEAD). Other worktrees were left alone. `/workspace/Roxysu` was left on `master`. Nothing was pushed.

This is a follow-up to the `0d84595` review. That commit landed the Plasma backend. These eight commits walk the plan from that document almost in order: serialize apply (D2), settle `--list-windows` (N3), log the layer-surface contract (D1 diagnosis), make the KWin grant visible on first connect (N1), destroy focus-backend objects (N2), bind hot-plugged outputs (N4), swap the review doc into the repo, then tighten Settings/desktop validation and add a Restart overlay control.

---

## What was and was not verified

**Verified in source (this commit):** the overlay-related diff against `0d84595` was read in full (`apps/overlay-rs/**`, `apps/desktop/overlayApplyLoop.js`, `overlayApplyPolicy.js`, `overlaySettings.js`, `overlayUrlGuard.js` and their tests, `main.js` spawn/poll path, `OverlayHostSection.tsx`, `settings.ts` + `settings.patch.test.ts`, `nix/package.nix`, `knowledge/features/in-game-overlay/index.md`). Every earlier item below was re-read at the cited lines.

**Tests that did run:** `bun test` on the four new/updated desktop modules in this worktree — `overlayApplyLoop`, `overlayApplyPolicy`, `overlaySettings`, `overlayUrlGuard` — **65 passed, 0 failed** (bun 1.4.4). That covers D2 sequencing, the restart nonce, settings-document trust, and the shell URL/output guard. It is not a compositor or Plasma run.

**Not verified (do not treat these as runtime measurements):**

- The Rust overlay was not built or run. This box still has `rustc`/`cargo` 1.85.1 but no `pkg-config`, no GTK/WebKit/gtk4-layer-shell development headers, and no Wayland compositor. `cargo test` / `cargo check` were not feasible. No `WAYLAND_DEBUG` trace, no RSS soak, and no live drift/noise or Plasma hide/show reproduction was performed.
- Whether five 200 ms grant retries are enough for KWin to advertise the privileged global after `kbuildsycoca6`, and whether Plasma `app_id` actually contains `osu`, remain unmeasured. `--list-windows` is now trustworthy enough to answer the second question on a real machine.

The same commits also touch unrelated UI/stats/sessions files. Those are out of scope here.

---

## What changed since `0d84595`

Eight commits, 2026-11-23 00:25–00:54 Europe/Lisbon:

| Commit | Intent vs the previous plan |
|--------|-----------------------------|
| `7eccb9d` | **D2.** `createApplyGate` + `executeOverlayDecision` (await stop, then spawn). Coalesced re-run. |
| `d845da3` | **N3.** `--list-windows` waits for Plasma `InitialState` or a quiet wlr batch, up to 16 roundtrips. Timeout log no longer says “foreign-toplevel”. |
| `d1d67c6` | **D1 logging only** (no behaviour change): map size/scale, `GdkSurface::layout` (configure), enter/leave monitor, `set_monitor` before/after including `mapped`. |
| `70dac94` | **N1.** `GrantOutcome`, fast retries after a fresh write, `kbuildsycoca` searched in usual Nix/distro paths, packaged desktop PATH includes `kdePackages.kservice`. |
| `325f781` | **N2.** `PlasmaTracking` + `destroy()` on Unmapped; wlr handles stored and destroyed on Closed. Tests for re-adopt. |
| `76e25cc` | **N4.** Registry `global` / `global_remove` bind and forget `wl_output`s; `OutputGone` in the reducer. |
| `5b93536` | Replaced `Roxysu-overlay-review(1).md` with the `0d84595` review under an `Opencode*` name; knowledge page updated. |
| `aa5a12b` | Settings trust + shell-side URL/output guard; Restart overlay nonce (`overlay.host_restart`); more tests. |

---

## Summary table

Status is relative to `/workspace/Roxysu-overlay-review-0d84595.md`.

| ID | Severity | Status | Title | Primary file | Effort left |
|----|----------|--------|-------|--------------|-------------|
| D1 | High | **Partly fixed** | Drift/noise diagnosis logs are in. Behaviour is unchanged: no unmap-before-pin, no wait-for-hint, still 1920×1090, same WebView on web-process death, DMA-BUF still forced on. | `overlay.rs` | Medium (behaviour; see below) |
| D2 | Medium | **Fixed** | Apply is gated and `stopChild` is awaited before spawn. Desktop unit tests cover the race. | `overlayApplyLoop.js`, `main.js` | Residual: stopChild can still give up after SIGKILL and leave a zombie |
| H1 | High | **Partly fixed** | N2 is fixed; N1 is much improved. Remaining: grant may still miss on a first `--list-windows`, M5 matching, M6 virtual desktops. | `focus/plasma.rs`, `grant.rs` | Small–medium residuals |
| H2 | High | **Partly fixed** | Auto-pin unchanged. First `Show` can still lack a hint; later `set_monitor` on a mapped surface is now *logged* (`mapped=true`). | `overlay.rs` | Small (do with D1 behaviour) |
| M3 | Medium | **Open** | N2 protocol-object leak is closed. Age cap still `--watchdog-max-age-sec=0`. No soak. | `watchdog/`, `main.js` | Measure first |
| M4 | Medium | **Fixed** | Hot-plug bind + `OutputGone`. Residual: `wl_output.release` is not sent on unplug. | `focus/wayland.rs`, `reducer.rs` | Tiny residual |
| M5 | Medium | **Open** | Matcher unchanged. `--list-windows` is now a reliable dump, so this is unblocked. | `focus/matching.rs` | Small, after a real Plasma dump |
| M6 | Medium | **Partly fixed** | Minimized still first-class; virtual desktop / activity still ignored. Unchanged, still unverified on Plasma. | `focus/plasma.rs` | Small if Active is insufficient |
| M7 | Medium | **Fixed** | Still passes `--output`. Shell now re-validates URL and output before argv (`overlayUrlGuard.js`). | `main.js`, `overlayUrlGuard.js` | — |
| M8 | Medium | **Open** | Layer reassert still diagnostic-only. | `diagnostics.rs` | Unchanged |
| L1 | Low | **Fixed** | Unchanged since `0d84595`. | `run.sh` | — |
| L2 | Low | **Open** | Still `DEFAULT_WIDTH=1920`, `DEFAULT_HEIGHT=1090`. | `config.rs` | Small (bundle with D1 size-to-output) |
| L3 | Low | **Open** | Focus channel still `async_channel::unbounded`. | `overlay.rs` 287 | Small |
| L4 | Low | **Fixed** | Unchanged. | `focus/wayland.rs`, `main.rs` | — |
| L5 | Low | **Fixed** | Knowledge page updated for grant retries, destroy, hot-plug, D1 logs, restart nonce. | `knowledge/features/in-game-overlay/index.md` | — |
| L6 | Low | **Open** | `contains` + `osu` still default. | `focus/matching.rs` | Unchanged |
| L7 | Low | **Fixed** | Dump waits for properties; timeout wording fixed. Residual: `--list-windows` does not use N1 fast retries. | `focus/wayland.rs`, `overlay.rs` | Tiny residual |
| L8 | Low | **Partly fixed** | Still a free-text monitor box. New: Restart overlay button (recovery for a visually dead HUD). No connector picker, no match-policy UI. | `OverlayHostSection.tsx` | Small residual |
| N1 | High | **Partly fixed** | Fresh-write fast retries + broader `kbuildsycoca` search + packaged PATH. Residuals: `--list-windows` is one-shot; 1 s of fast retry may not be enough; a missing cache rebuild can still need a relog. | `grant.rs`, `wayland.rs`, `nix/package.nix` | Small residual |
| N2 | Medium | **Fixed** | `destroy()` + `seen` cleared on Unmapped; wlr handles destroyed on Closed. Unit tests for re-adopt. | `focus/plasma.rs`, `focus/wayland.rs` | — |
| N3 | Medium | **Fixed** | Settles on Plasma `InitialState` or a quiet wlr batch; warns if the cap is hit. Tests for settle rules. | `focus/wayland.rs` | — |
| N4 | Medium | **Fixed** | Late `wl_output` bind and `OutputGone`. Residual: no `release()` on unplug; no duplicate-global guard. | `focus/wayland.rs` | Tiny residual |

**Counts (the previous 22 items):** **10 fixed** (D2, M4, M7, L1, L4, L5, L7, N2, N3, N4), **6 partly fixed** (D1, H1, H2, M6, L8, N1), **6 still open** (M3, M5, M8, L2, L3, L6). No new high-severity defects in the new code. Small residuals are noted under N1, N4, D1 logging, and D2.

**Top 3 remaining:**

1. **D1 behaviour** — the logs are enough to *classify* a drift/noise incident; they do not fix it. Next change is unmap → pin → remap, do not map until an output hint exists, size to the output (L2), and recreate the `WebView` after web-process death.
2. **M5** — now unblocked. Take a settled `--list-windows` dump on the user’s Plasma session before widening the matcher. Until then, a generic Plasma `app_id` still fail-closes the HUD.
3. **N1 residuals** — first-run `--list-windows` still has no fast retry; if the grant is not visible after five 200 ms attempts, Plasma stays unmapped until the slower backoff (or a relog).

---

## D1 — Overlay dies, drifts, then becomes noise

**Severity:** High | **Status:** **Partly fixed** (diagnosis only)

### What landed

`overlay.rs` now logs the surface contract at **info** (the default host level, so it will appear in the desktop overlay log without `--debug`):

- On `map` (`overlay.rs` 133–137): widget `width×height` and `scale_factor`.
- `window.connect_scale_factor_notify` (`158–160`).
- On every map, `wire_surface_logs` (`576–598`) attaches:
  - `GdkSurface::layout` → `surface layout (layer-shell configure)` with the configured width/height (this is the layer-shell configure, as seen by GTK);
  - `enter-monitor` / `leave-monitor` with connector, model, geometry, and `monitor.scale()`.
- `pin_overlay` (`620–652`) logs `output`, previous pin (`from`), **`mapped`**, monitor geometry, and scale. That `mapped` flag is the diagnosis for “`set_monitor` on an already-mapped surface,” which the previous review called out as a new D1 trigger.

Handlers are disconnected and rewired on each map, because GTK may give the window a new `GdkSurface` after unmap. A small hygiene gap: the previous handler ids are disconnected from the *current* surface. If the surface object changed, the old ids are not on it (the old surface is usually destroyed on unmap, so this is likely harmless). Storing the previous `GdkSurface` and disconnecting from *it* would be cleaner.

`web-process-terminated` is still only a reload of the same `WebView` (`430–446`), with the existing warn log.

### Is the logging enough to diagnose drift?

**Yes, for classifying which trigger fired. No, for seeing a DMA-BUF stride/format mismatch directly.**

A real incident should be readable from the overlay log as one of:

1. `pinned overlay to osu! output` with `mapped=true` (or a first pin shortly after map) followed by a `surface layout` with a surprising size — the set-monitor-after-map / configure-fight branch.
2. `window scale factor changed` or a monitor `scale=` that does not match the widget scale at map — the scale-change branch.
3. `webkit: web process terminated` then a reload, then shear — the poisoned-renderer branch.
4. A `surface layout` of `1920×1090` (or another size larger than the output) on a 1080p (or scaled) monitor — the default-size / exclusive-zone branch (L2).

What the logs still cannot show: the actual `wl_buffer` width, stride, modifier, or whether WebKit reused a released DMA-BUF. If the info logs do *not* line up with the moment of shear, the next diagnostic is `WAYLAND_DEBUG=1` on the host (or a compositor dump), not more GTK widget logs.

**Please capture one failing session’s overlay log before or while landing the behaviour fix.** This box could not reproduce the bug.

### Behaviour still open

Unchanged from `0d84595`:

- `set_monitor` is still called on a live surface when the hint changes after map (`pin_overlay` at `overlay.rs` 637; the call site is `310`).
- A first `Show` with `output: None` still `present()`s on KWin’s default output (often the Roxysu monitor), then pins later (`305–318`, `540–550`).
- Default size is still 1920×1090 (`config.rs`).
- Web-process death still `load_uri`s the same widget.
- Desktop still forces DMA-BUF on (`main.js` 654–658) and still passes `--watchdog-max-age-sec=0`.

### Next D1 behaviour fix (this is the next host patch)

Do these together, in this order, so a pin cannot fight a live buffer:

1. **Do not map until an output hint exists** (also closes the H2 first-frame flash), unless `--output` was set. Fail-closed for placement, not only for focus.
2. **On an output change: unmap, `set_monitor`, remap.** Re-apply click-through on the next `map` (already done). Accept a brief flicker when osu! is dragged between monitors.
3. **Size the layer surface to the chosen output** (or the HUD bbox) and follow `layout`/configure (L2). Drop 1920×1090 as a hard default.
4. **Recreate the `WebView` (and preferably the layer surface) after `web-process-terminated`**, not `load_uri` on the same widget.
5. Keep `--webkit-no-dmabuf` as an A/B, not a default.

A Settings **Restart overlay** button (`aa5a12b`) is a useful recovery if the HUD is already garbage; it is not a fix. It goes through the now-serialized stop→spawn path, so a click should not itself cause two surfaces (D2). Latency is one poll interval (up to ~4 s) plus stop grace.

### Trade-offs and tests

Unmap-before-pin flickers on monitor moves; better than shear. Recreating the WebView reloads the HUD (already paid, ineffectively, on web-process death).

Tests: unit tests cannot reproduce DMA-BUF shear. Manual: niri *and* Plasma; drag osu! across monitors; output mode / fractional scale change; `pkill` the WebKit web process; confirm the log lines above appear, then confirm the picture stays clean. Not run here.

---

## Earlier items, re-checked

### D2 — Overlay apply still races — **Fixed**

`apps/desktop/overlayApplyLoop.js` introduces:

- `createApplyGate`: one in-flight `apply()`; further polls coalesce into a single re-run (`main.js` 770–839, `finally` always `end()`s, including on throw).
- `executeOverlayDecision`: if `stopRunning`, `await deps.stop()` then `deps.spawn(...)`.

`watchOverlayHostSetting` uses both. Spawn nulls `overlayChild` only after the awaited stop. Desktop tests include “spawn with `stopRunning` does not spawn until stop resolves” and “overlapping polls run once, then one coalesced re-run.” All 65 related bun tests passed.

**Residual:** `stopChild` can still resolve after the SIGKILL deadline while a stuck process lives; a second host could then be spawned. That is the existing stop policy, not a new race. Quit already `Promise.all`s stops.

### H1 — Plasma hide — **Partly fixed** (closer)

N2 (re-adopt after osu! restart) is fixed. N1 is improved (below). Fail-closed, minimized, and observe-only Plasma are unchanged and still correct.

Still open for a “doesn’t hide / never shows” report: **M5** (generic `app_id`), **M6** (virtual desktop, unverified), and N1 if the grant never becomes visible. After this series, “never shows” is the more likely Plasma failure than “stuck visible on the Roxysu monitor,” unless H2’s first unhinted map is what the user still sees.

### H2 — Wrong monitor — **Partly fixed**

Pinning logic is unchanged. The first unhinted `Show` and pin-after-map remain. They are now visible in the D1 logs (`mapped=true`, enter/leave monitor). Fix them as part of the D1 behaviour patch, not as a separate path.

Fractional-scale Plasma geometry vs `GdkMonitor.geometry()` is still unverified. The new monitor label logs both geometry and `scale=`, which is the right evidence to collect.

### M3 — Memory — **Open**

The N2 protocol-object suspicion is addressed. The WebKit/RSS question is unchanged: age cap still 0, no soak on this box. Measure mapped vs unmapped vs post-reload tree RSS on a real session before adding an age cap back.

### M4 — Follow osu! across monitors — **Fixed**

`Dispatch<WlRegistry>` now binds late `wl_output`s and on `global_remove` drops the name, pending enters, and the proxy, and emits `ToplevelEvent::OutputGone` (`wayland.rs` 553–590, `reducer.rs` 193–204). Reducer tests cover name removal.

**Residuals:** on unplug the code drops the `WlOutput` without `release()` (the v3+ destructor). Same class of hygiene as N2, smaller because unplug is rare. `bind_late_output` does not guard `output_globals.contains_key(name)`; `registry_queue_init` should not re-dispatch the initial list, but a defensive check would be cheap.

Pin-after-map while following a drag is still the D1 risk, not an M4 functional miss.

### M5 — Title ignored when `app_id` is non-empty — **Open**

Policy unchanged, deliberately. **Do not widen it until a settled `--list-windows` dump from the user’s Plasma session is in hand.** N3 makes that dump trustworthy (except first-run grant — N1 residual).

### M6 — Minimized / other desktop — **Partly fixed**

Unchanged: minimized is honoured; `virtual_desktop_entered` / `left` and activities are still `_ => {}`. Still needs a manual “switch Plasma desktop, leave osu! behind” test.

### M7 — `--output` from Settings — **Fixed**

Still wired. `aa5a12b` adds `overlayUrlGuard.js` (mirror of the server parser) and `guardOverlaySettings` in `main.js` 727–748: a bad URL falls back to the default HUD URL, a bad output falls back to follow-osu!, both logged. GET `/api/settings` is only trusted on HTTP 200 with a boolean `overlay.enabled` (`overlaySettings.js`) — a 500 error document can no longer be misread as “enabled.”

### M8 — Layer reassert — **Open**

Unchanged. Test after H1 on KWin exclusive fullscreen; do not enable the bounce by default until that fails.

### L1, L4, L5 — **Fixed** (unchanged or docs updated)

L5 knowledge now covers grant retries, destroy, hot-plug, the D1 log set, serialized apply, and the restart nonce.

### L2, L3, L6 — **Open**

Unchanged. Fold L2 into the D1 size-to-output work. L3 still unbounded. L6 still documented in a matcher test.

### L7 — `--list-windows` — **Fixed**

`run_once` no longer breaks on the first toplevel (`wayland.rs` 383–402). Plasma settles when `plasma_pending_initial` is empty (`InitialState` or Unmapped clears it, `plasma.rs` 99–104, 135). wlr settles on a quiet batch (`list_settled`, with `is_dirty()` sampled *before* `flush_batch`). Cap is 16 roundtrips, with a warning if still pending. The 3 s timeout message is now “timed out waiting for the toplevel dump” (`overlay.rs` 225). Unit tests cover settle rules and “unmap before InitialState still settles.”

**Residual:** `run_list_windows` is still a single `run_once` with no N1 fast retry. A first-run Plasma `--list-windows` can fail to bind and then hit the 3 s timeout instead of retrying.

### L8 — Settings UI — **Partly fixed**

Monitor field unchanged (free text). New **Restart overlay** button patches `overlayRestartHost: true`, which bumps `overlay.host_restart` to `max(now, prev+1)` (`settings.ts` 504–514). The shell treats a new nonce as `restart-requested`, bypasses the respawn gap, and stop→spawns once (`overlayApplyPolicy.js` 101–121). Server and policy tests cover monotonic clicks and “disabled ignores a restart nonce.” Still no connector picker or match-policy UI.

---

## N1–N4, re-checked

### N1 — KWin grant not live for the first focus connection — **Partly fixed**

What landed:

- `install_plasma_grant()` returns `GrantOutcome`; `wrote_fresh()` is true only for a write this run (`grant.rs` 14–37, tests at 202–210).
- `run_app` passes that into `present_initial` → `spawn_focus_loop` (`main.rs` 121–142, `overlay.rs` 205, 234, 286–288).
- After a fresh write, the first five failed binds wait 200 ms instead of the 1 s→30 s ladder (`wayland.rs` 302–349). Fail-closed is unchanged (`Unavailable` still does not map).
- `kbuildsycoca6`/`5` are tried from PATH and then `/run/current-system/sw/bin`, `~/.nix-profile/bin`, `/etc/profiles/per-user/$USER/bin`, `/usr/bin`. The warning if none are found tells the user to install `kdePackages.kservice` or run `kbuildsycoca6` and relog.
- The Nix desktop wrapper now prefixes `kdePackages.kservice` onto PATH (`nix/package.nix`), so a packaged spawn inherits `kbuildsycoca6`.

Residuals:

1. **`--list-windows` does not retry.** `run_list_windows` calls `run_once` once and ignores `grant_fresh` (`wayland.rs` 285–288; `overlay.rs` 207–216). First-run Plasma dumps can still be empty/errors. Share the fast-retry loop, or have `run_list_windows` take `grant_fresh`.
2. Five×200 ms is a reasonable guess, not a measurement. If KWin needs longer (or a relog when sycoca never ran), the host falls back to the slow ladder and stays unmapped — correct, but slow.
3. Grant install still happens after the GTK connection, which is fine; only the focus connection needs the global.

### N2 — `seen_plasma` / missing `destroy` — **Fixed**

`PlasmaTracking` (`wayland.rs` 101–136) stores internal id ↔ proxy id. `try_adopt` / `link` / `release` are tested: a released internal id can be adopted again; distinct windows stay independent; `release` without a link is `None`.

On `Unmapped` (`plasma.rs` 89–98): `window.destroy()`, `plasma_tracking.release`, remove from `plasma_windows` and `plasma_pending_initial`, then `Closed`. That `destroy` is the resource destructor, not a window-management request — still observe-only.

On wlr `Closed` (`wayland.rs` 691–697): `handle.destroy()`, drop the stored handle, then `Closed`. Handles are inserted when `Toplevel` is created (632).

No new protocol misuse spotted in this path. `destroy` is issued on the event that ends the object, then the proxy is dropped.

### N3 — `--list-windows` empty fields — **Fixed**

See L7. This was the recommended M5 diagnostic; it should now print real `app_id` / `title` / `resource_name` once the backend binds.

### N4 — `wl_output` hotplug — **Fixed**

See M4. Comment at `wayland.rs` 562–566 correctly describes the `registry_queue_init` contract. Add a `contains_key` guard and `release()` when convenient.

---

## Desktop / Settings integration (`7eccb9d` + `aa5a12b`)

This is in good shape.

- **D2 wiring in `main.js`** matches the tested loop helper. `finally` + coalesce avoids a stuck gate and avoids dropping a Settings save that landed mid-stop.
- **Settings document trust** (`parseOverlaySettingsResponse`): 200 + object `overlay` + boolean `enabled`. 64 KiB body cap. Tests include “500 must not look like enabled.”
- **Shell argv guard** mirrors `parseOverlayHostUrl` / `parseOverlayOutput`. Fallback is fail-soft (default URL / follow osu!), which is right for a poll path that should not kill a running HUD because of one bad stored value — and is logged.
- **Restart nonce** is monotonic, stored as a string, ignored when the overlay is disabled, and applied exactly once per click. Rapid clicks are tested on the server (`max(now, prev+1)`).
- **Packaging:** `overlayApplyLoop.js`, `overlaySettings.js`, and `overlayUrlGuard.js` are listed in the Nix pack and assert scripts (`aa5a12b`), so they will not be missing from a packaged `main.js` require.

No new apply race was found in this reading. The remaining desktop overlay gap is still the forced DMA-BUF + disabled age cap (D1/M3), not Settings.

---

## New-code notes (not separate IDs)

- Plasma bind range is still `7..=18` (`wayland.rs` 488). Same remark as before: modern KWin will bind 18; consider a floor of 17 later.
- `list_settled` for Plasma does not require a quiet batch, only empty `plasma_pending_initial`. That is what the protocol’s `InitialState` is for.
- `pin_overlay(..., mapped)` uses `*mapped.borrow()` from the GTK map/unmap flags, which is the right signal for D1 logs.
- The repo still contains `OpencodeRoxysu-overlay-review-0d84595.md` (a copy of the previous review). It is historical; this document supersedes it.

---

## Prioritized fix plan

The previous “immediate” list is largely done (D2, N3, D1 logs, N1, N2, N4). The plan now is the D1 behaviour work, plus the small residuals and a Plasma confirmation.

### 1. Now (host behaviour + one real log)

1. **Capture a D1 log** from a session that shears, if the user can still reproduce it (info lines listed above; optionally `WAYLAND_DEBUG=1`).
2. **D1 behaviour + H2 residual + L2:** do not map without a hint; unmap → `set_monitor` → remap; size to the output and follow configure; recreate the `WebView` on web-process death.
3. **N1 polish:** pass `grant_fresh` into `--list-windows` and reuse the fast-retry loop so the M5 dump works on a first Plasma launch.

### 2. On a real Plasma session (short)

4. Run the settled `--list-windows`. Only if `app_id` would miss, loosen **M5** (for example `resource_name` or title as a fallback with a tight rule — not “any field contains osu”).
5. Manual matrix: first-run grant (N1), alt-tab, minimize, virtual desktop (M6), two monitors and a hot-plug (M4/N4), osu! restart (N2), exclusive fullscreen (M8 if it fails), Settings Restart overlay.

### 3. After that has been soaked

6. M8 only if hide→show over fullscreen fails.
7. L3 bounded focus channel.
8. N4 `wl_output.release` + duplicate-global guard.
9. Performance (HUD bbox, WebKit flags) and a long-session RSS soak (M3) — measure, do not guess.
10. Heartbeat / a less violent age-cap policy than “never.” Replacing WebKit stays backlog.

### Suggested sequence

D1 log (if reproducible) → D1 behaviour (unmap-before-pin, wait-for-hint, size-to-output, recreate WebView) → N1 `--list-windows` retry → Plasma `--list-windows` dump → M5 only if needed → M6/M8 only if the manual matrix fails.

---

## Review limits, restated

Desktop overlay unit tests were run and passed (65). The Rust host was not built or run; no compositor measurements were taken. Protocol remarks use the same public Plasma/wlr contracts as the previous review plus the new source lines. The user’s drift/noise bug should be re-checked with the new info logs, then with the behaviour patch above — not assumed fixed.

