# Roxysu overlay host on `play/rune-migration` @ `0d84595` — review and fix plan

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch reviewed:** `play/rune-migration`  
**Commit:** `0d845951ffb59bb1b1e8486927f5f965311510a2`  
(“Add comprehensive overlay review and enhance desktop integration”, 2026-11-23 00:10 Europe/Lisbon)  
**Compared against:** `a07a7f50ac880df36ef842b9d83bb64922ab3f90` (the previous overlay review and deep dive)  
**Review date:** 2026-11-23  
**Worktree (read-only):** `/workspace/rx-overlay-0d84595` (detached HEAD). Other worktrees were left alone. `/workspace/Roxysu` was left on `master`. Nothing was pushed.

This is a follow-up to `/workspace/Roxysu-rune-overlay-review.md` and `/workspace/Roxysu-overlay-deep-dive.md`. The previous review found `apps/overlay-rs` byte-identical to `master` (`bc3eb6b`). This commit is the first one that actually implements the Plasma focus/monitor design, plus Settings/desktop `--output` wiring. The user’s original Plasma bugs (wrong monitor, no hide), the suspected leak, and the drift/noise failure (D1) are re-checked against this tree.

---

## What was and was not verified

**Verified in source (this commit):** the overlay-related diff against `a07a7f50` was read in full (`apps/overlay-rs/**`, `nix/overlay-rs.nix`, `apps/desktop/main.js`, `overlayApplyPolicy.js` + tests, `apps/server/src/overlayUrl.ts` + tests, `routes/settings.ts`, `OverlayHostSection.tsx`, `packages/db/src/settings-keys.ts`, `knowledge/features/in-game-overlay/index.md`). Every earlier item below was re-read at the cited lines. Plasma protocol details (state bitflags, `geometry` / `client_geometry`, `unmapped`, `destroy`, virtual-desktop events, bind version notes) were checked against the current public protocol text, not against a running KWin.

**The bundled file `Roxysu-overlay-review(1).md` in this commit** is byte-identical to `/workspace/Roxysu-overlay-review.md` (the original `master` / `bc3eb6b` review from 2026-11-17). It is **not** the rune-migration review and **not** the Plasma/performance deep dive. The `(1)` filename looks like a browser-download duplicate. It describes Plasma follow-focus as missing, which is no longer true at `0d84595`. It should not be treated as the current review; either drop it from the branch or replace it with this document.

**Not verified (do not treat these as runtime measurements):**

- The overlay binary was not built or run. This box has `rustc`/`cargo` 1.85.1 (matches the crate’s `rust-version`) and a GTK 4 runtime, but no `pkg-config`, no GTK/WebKit/gtk4-layer-shell development headers, and no Wayland compositor. `cargo test --offline` failed immediately (no crate cache). An online `cargo test` would still fail at `pkg-config`. No unit tests, no `WAYLAND_DEBUG` trace, no RSS soak, and no on-screen hide/show or drift/noise reproduction was performed.
- KWin’s privileged-global grant, sycoca reload timing, and “only one client can bind this interface” wording were not observed on a live Plasma session. The protocol XML still says a single binder; current KWin is widely believed to allow multiple *granted* clients (plasmashell + others). If bind fails while the global is advertised, that is the first thing to check on a real machine.
- Actual osu!lazer / osu!stable / Wine `app_id`, `resource_name`, and Plasma geometry coordinate space (especially with fractional scaling) were not measured.

The commit also touches unrelated UI/stats/audio files (`wheelSeek`, `audioClock`, `StatsPage`, beatmap preview). Those are out of scope here.

---

## What changed since `a07a7f50`

This is a large, targeted overlay change, not a no-op host.

| Area | Change |
|------|--------|
| `focus/plasma.rs` (new) | Read-only `org_kde_plasma_window_management` backend: title, app id, X11 `resource_name`, active/minimized, `geometry` / `client_geometry`, `unmapped`. No `close`, `set_state`, move, resize, or desktop-change requests. |
| `focus/grant.rs` (new) | Writes `~/.local/share/applications/dev.roxysu.overlay.desktop` with `Exec=/proc/self/exe` and `X-KDE-Wayland-Interfaces=org_kde_plasma_window_management`, then runs `kbuildsycoca6` (or `kbuildsycoca5`) when the file changed. |
| `nix/overlay-rs.nix` | Installs the same `.desktop` for the store path. |
| `focus/wayland.rs` | Tries wlr-foreign-toplevel first, else Plasma. Follows `output_enter` / `output_leave`. Reconnects with backoff. `--list-windows` uses the same backend choice. |
| `focus/reducer.rs` | Hide unless matched **and** activated **and not minimized**. Emits a new `Show` when the output hint (name or bounds) changes. |
| `overlay.rs` | On `Show`, pins the layer surface to the matched window’s output (`set_monitor`) unless `--output` was set. Skips a repeat pin so KWin does not recreate the surface. Fail-closed if no backend. |
| `main.rs` | Installs the Plasma grant before the focus connection. Joins the focus thread on GTK shutdown. |
| `run.sh` / CLI | No longer hardcodes `--output=DP-4`. Default is follow-the-window. `--list-windows` help mentions Plasma. |
| Desktop + Settings | `overlay.host_output` is stored, validated, shown in Settings, and passed as one `--output=` argv token. A monitor change restarts the host. Policy tests cover this. |
| Docs | `knowledge/features/in-game-overlay` now describes the Plasma backend, the grant, fail-closed behaviour, and the output setting accurately. |

What this commit does **not** change: default `1920×1090` surface, DMA-BUF still forced on by the desktop, no layer-shell `configure` / scale observer, `web-process-terminated` still reloads the same `WebView`, desktop `apply()` still does not `await stopChild` and is not serialized, watchdog age cap still `--watchdog-max-age-sec=0`.

---

## Summary table

Status is relative to `/workspace/Roxysu-rune-overlay-review.md` and the original 16 overlay findings. New items are marked **New**.

| ID | Severity | Status | Title | Primary file | Effort |
|----|----------|--------|-------|--------------|--------|
| D1 | High | **Open** | Overlay “dies,” shears left→right, then becomes garbage pixels. Still no configure/scale observer, no WebView recreate, default 1920×1090, DMA-BUF forced on. `set_monitor` after map is a *new* trigger. | `overlay.rs`, `main.js` | Medium–large (log first, then unmap-before-pin + size-to-output + recreate) |
| D2 | Medium | **Open** | Overlay `apply()` still does not `await stopChild` and is not serialized. Two layer surfaces, or SIGKILL of a mapped client, can coincide with D1. | `apps/desktop/main.js` | Small |
| H1 | High | **Partly fixed** | Plasma follow-focus exists and is fail-closed; minimized is honoured. Residuals: grant may not be live on the first connection (N1), matching may miss lazer (M5), virtual desktop is not first-class (M6), `seen_plasma` / `destroy` (N2). | `focus/plasma.rs`, `grant.rs`, `reducer.rs` | Medium (residuals) |
| H2 | High | **Partly fixed** | Auto-pin from `wl_output` name or Plasma geometry, plus a Settings `--output` override. Residuals: first `Show` can have no hint; fractional-scale coordinates; `set_monitor` after map. | `overlay.rs`, `reducer.rs` | Small–medium |
| M3 | Medium | **Open** | Still no confirmed Rust leak. Age cap still disabled by the desktop. New suspicion: Plasma/wlr objects may not be `destroy`ed (N2). No soak was run. | `watchdog/`, `main.js`, `focus/` | Unchanged + N2 |
| M4 | Medium | **Partly fixed** | Output-hint changes emit a new `Show` and re-pin. Hot-plugged `wl_output`s are never bound on the focus connection (N4). | `focus/wayland.rs`, `overlay.rs` | Small residual |
| M5 | Medium | **Open** | Title is still ignored when `app_id` is non-empty; `resource_name` is dump-only. More serious now: fail-closed means a generic Plasma `app_id` (`dotnet`, …) hides the HUD forever. | `focus/matching.rs` | Small, after a real `--list-windows` dump |
| M6 | Medium | **Partly fixed** | Minimized is first-class. Virtual desktop / activity events are ignored. Active-bit clearing may be enough; it is unverified on Plasma. | `focus/reducer.rs`, `focus/plasma.rs` | Small if Active is insufficient |
| M7 | Medium | **Fixed** | Settings + desktop spawn pass `--output`. Empty means follow the window. | `main.js`, `OverlayHostSection.tsx`, `overlayUrl.ts` | — |
| M8 | Medium | **Open** | Layer reassert on show is still behind `--diag-reassert-placement`. | `diagnostics.rs` | Unchanged |
| L1 | Low | **Fixed** | `run.sh` only adds `--output` when `ROXYSU_OVERLAY_OUTPUT` is set. | `apps/overlay-rs/run.sh` | — |
| L2 | Low | **Open** | Default surface is still 1920×1090 (10 px taller than 1080p). | `config.rs` | Small |
| L3 | Low | **Open** | Focus command channel is still `async_channel::unbounded`. | `overlay.rs` | Small |
| L4 | Low | **Fixed** | `FocusHandle::stop` joins the thread; GTK `shutdown` and `Drop` both call it. | `focus/wayland.rs`, `main.rs` | — |
| L5 | Low | **Fixed** | Docs now describe the Plasma backend, the grant, and fail-closed behaviour correctly. | `knowledge/features/in-game-overlay/index.md` | — |
| L6 | Low | **Open** | Default `contains` + needle `osu` can still false-positive (`bosun`). Documented in a test. | `focus/matching.rs` | Unchanged |
| L7 | Low | **Partly fixed** | `--list-windows` uses the Plasma backend, but can dump empty `app_id`/`title` (N3). Timeout log still says “foreign-toplevel”. | `focus/wayland.rs` | Small residual |
| L8 | Low | **Partly fixed** | Settings gained a monitor field. It is a free-text box, not a connector picker, and there is still no match-policy UI. | `OverlayHostSection.tsx` | Small residual |
| N1 | High | **New** | The KWin grant can be written after GTK has already connected, and `kbuildsycoca6` may be missing from a Nix-wrapped Electron PATH. First (or every) Plasma session then stays unmapped until the cache is rebuilt. | `grant.rs`, `main.rs`, `nix/overlay-rs.nix` | Small–medium |
| N2 | Medium | **New** | `seen_plasma` is not cleared on `Unmapped`; `destroy()` is never called on Plasma windows or wlr handles. A reused internal id after osu! restart can silently drop tracking. | `focus/plasma.rs`, `focus/wayland.rs` | Small |
| N3 | Medium | **New** | `--list-windows` breaks as soon as any toplevel exists, often before `InitialState`. The recommended M5 diagnostic can print empty fields. | `focus/wayland.rs` | Small |
| N4 | Medium | **New** | The focus connection’s `wl_registry` handler is empty; new `wl_output`s after start are never named. Hurts M4 on niri when a monitor is plugged in. | `focus/wayland.rs` | Small |

**Counts:** of the previous 18 overlay items (**16 earlier + D1 + D2**): **4 fixed** (M7, L1, L4, L5), **6 partly fixed** (H1, H2, M4, M6, L7, L8), **8 still open** (D1, D2, M3, M5, M8, L2, L3, L6). **4 new** (N1 High, N2/N3/N4 Medium).

**Top 3 to fix next:** D2 (serialize and await stop — small, and it can *cause* D1), D1 (the drift/noise bug is untouched), N1 + a real Plasma `--list-windows` dump for M5 (otherwise H1/H2 can still look “broken” on Plasma: the HUD never appears, or it appears on the wrong monitor until geometry arrives).

---

## Earlier and still-open issues, one by one

### D1 — Overlay dies, drifts left to right, then becomes noise / garbage pixels

**Severity:** High | **Status:** **Open** (not addressed in this commit; one new trigger was added)

#### Root cause

Unchanged from the previous review: this sequence is what a compositor looks like when it is still scanning a `wl_buffer` whose width, stride, scale, or backing store no longer matches the layer surface, or a DMA-BUF that was released and recycled. The host still:

1. Never observes layer-shell `configure`, output mode, or scale (`overlay.rs` sets `default_width` / `default_height` once and has no `size_allocate` / `GdkMonitor` scale listener).
2. Defaults to **1920×1090** (`config.rs`), already 10 px taller than a 1080p playfield, with two-edge anchoring and `exclusive_zone = -1`.
3. Uses DMA-BUF by default. The desktop still forces it on and still documents why the software fallback greys the window (`main.js` around the `spawn` call).
4. On `web-process-terminated`, reloads the **same** `WebView` (`overlay.rs` 409–421). It does not drop the GPU/DMA-BUF context or recreate the widget.

**New in this commit:** `pin_overlay` calls `window.set_monitor` when the osu! output hint changes. The comment at `overlay.rs` 540–541 is explicit that a repeat `set_monitor` is skipped “so KWin does not recreate the layer surface.” The first pin, and any later pin to a *different* monitor, still call `set_monitor`. If that happens after the surface is already mapped (first `Show` had no hint, or the player dragged osu! to another monitor), KWin may destroy and recreate the layer surface. The host still does not handle the following `configure`. That is a plausible, newly introduced D1 trigger.

#### Impact

Playfield-covering corruption. On Plasma, if follow-focus is working, at least the garbage should unmap when osu! is not focused; if follow-focus is *not* working (N1/M5), the noise can sit on the Roxysu monitor instead, which is the old H1/H2 combination.

#### Repro

Same as the previous review, plus: on Plasma, start the overlay, wait until it is visible, then drag osu! between monitors (forces `set_monitor` on a mapped surface). Also: start with osu! already focused but before geometry has arrived, then watch the first pin. Confirm with `WAYLAND_DEBUG=1` and a log of configured size vs attached buffer (that logging still does not exist).

#### Proposed patch

1. **Log the surface contract** (do this first; no behaviour change): layer-shell configure width/height, `GdkMonitor` scale and geometry, `set_monitor` before/after, and WebKit `web-process-terminated` reason.
2. **Unmap, pin, then remap** when the output changes, instead of `set_monitor` on a live surface. Re-apply click-through on the next `map` (already done).
3. **Size the layer surface to the chosen output** (or to the HUD bbox), and follow configures. Drop the 1920×1090 default (L2).
4. **Recreate the `WebView` (and preferably the layer surface) after a poisoned renderer**, not `load_uri` on the same widget.
5. Keep `--webkit-no-dmabuf` as an A/B, not a default, until (2)–(4) are soaked.

#### Trade-offs

Unmap-before-pin will flicker (brief hide) when moving osu! across monitors; that is better than a sheared DMA-BUF. Recreating the WebView costs a HUD reload (already paid on web-process death today, just ineffectively).

#### Tests

Unit tests cannot reproduce DMA-BUF shear. Manual: niri *and* Plasma; output mode change; fractional scale; drag osu! across monitors; kill the web process (`pkill WebKitWeb` or equivalent) and confirm the HUD returns clean, not as noise. No measurements were taken here.

---

### D2 — Overlay apply still races

**Severity:** Medium | **Status:** **Open** (output-change restarts were added; the race was not)

#### Root cause

`watchOverlayHostSetting` still fires `apply()` on a 4 s interval with `void apply()` and no in-flight guard (`main.js` 614–669). On `stop` or `spawn` with `stopRunning`:

```
if (decision.stopRunning) stopChild(overlayChild, "overlay");
overlayChild = null;
spawnOverlayHost(paths, decision.urlArg, decision.output ?? null);
```

`stopChild` returns a Promise (SIGTERM, 5 s grace, then SIGKILL, 2 s deadline) and is **not awaited**. A new host is spawned immediately. The same pattern now also runs when the user saves a monitor (`reason === "output-changed"`), so this commit makes the race easier to hit, not harder. Two `apply()` calls can also overlap if a fetch or stop outlives the 4 s poll.

Quit already does `Promise.all(stops)` and waits. Only the poll path is wrong.

#### Impact

Two layer-shell surfaces at once, or SIGKILL of a mapped DMA-BUF client — a practical D1 trigger when the user changes URL or monitor.

#### Repro

Enable the overlay, then change the monitor field in Settings (or the HUD URL) and save. Watch the overlay log for two processes, or a shear at the moment of restart.

#### Proposed patch

1. Give `apply()` an in-flight mutex (ignore or coalesce polls while a stop/spawn is running).
2. `await stopChild(...)` before `spawnOverlayHost`.
3. Only then clear `overlayChild` / applied args and spawn.

The decision helper can stay pure; this is wiring in `main.js`.

#### Trade-offs

A URL or monitor change can take up to ~7 s to apply if the old host ignores SIGTERM. That is the existing stop policy; it should be visible, not concurrent.

#### Tests

The policy tests already cover `output-changed` + `stopRunning: true`. Add a small test or a documented manual check that `apply` does not spawn until `stopChild` resolves. An overlapping-poll test is feasible if `apply` is extracted.

---

### H1 — On Plasma the overlay does not hide when osu! loses focus or is hidden

**Severity:** High | **Status:** **Partly fixed**

#### What landed

This is the core of the commit, and it matches the earlier design in the important respects:

- Backend choice is wlr first, Plasma second (`wayland.rs` 353–385). Missing both emits `FocusCommand::Unavailable` and stays unmapped. `--follow-focus=false` is the only always-visible path.
- Plasma is observe-only (`plasma.rs`). State uses the documented bitfield (`Active = 0x1`, `Minimized = 0x2`); `flags & (State::Active as u32)` is the correct test.
- The reducer shows only when a matched window is `activated && !minimized` (`reducer.rs` 215). Tests cover minimized, alt-tab batches, and close.
- Hide is still a hard `set_visible(false)` through `sync_gate`, with the existing hysteresis (default 80 ms).
- The privileged global is requested via a `.desktop` grant (`grant.rs`, `nix/overlay-rs.nix`).

#### What is still open

1. **N1 — the grant may not be visible yet** when the focus connection binds. Fail-closed then looks like “the overlay never shows,” which is a new failure mode versus the old always-visible fallback.
2. **M5 — matching.** If Plasma reports a non-empty `app_id` that does not contain `osu`, the HUD stays unmapped even with a working grant.
3. **M6 residual — virtual desktops / activities** are ignored (`virtual_desktop_entered` / `left`, `activity_*`). If KWin clears `Active` when the user switches desktop, hide still works; that was not observed here.
4. **N2 — `Unmapped` + `seen_plasma`.** After osu! is closed and started again, a reused internal id would never be adopted, so follow-focus dies until the host restarts.

#### Impact

On a Plasma session where the grant is live and `app_id` contains `osu`, hide on alt-tab and minimize should now work, including the cases that already worked on niri. If either residual fails, the user will see “no overlay” (fail-closed) rather than the old “stuck on the Roxysu monitor.”

#### Repro

On Plasma: install/start Roxysu, confirm a log line `focus loop running` with `backend=org_kde_plasma_window_management`. Alt-tab, minimize osu!, switch virtual desktop, close and reopen osu!. Also run `--list-windows` *after* N3 is fixed.

#### Proposed patch

Fix N1, N2, N3 first, then take one `--list-windows` dump on the user’s Plasma session and only then loosen matching (M5) if the real `app_id` would miss. Add virtual-desktop tracking only if hide fails when switching desktops while `Active` stays set.

#### Trade-offs

Fail-closed is the right default; it must be accompanied by a clear log and a working `--list-windows`. Do not revert to always-visible on Plasma.

#### Tests

Reducer tests already cover minimize and alt-tab. Add tests for virtual-desktop leave if that state is modelled. Manual Plasma matrix as above. Not run here.

---

### H2 — On Plasma the overlay opens on the Roxysu monitor, not the osu! monitor

**Severity:** High | **Status:** **Partly fixed**

#### What landed

- The reducer carries an `OutputHint`: `Name` (wlr `wl_output` name, last entered) or `Rect` (Plasma `geometry` / `client_geometry`).
- On `Show`, if `--output` is unset, `pin_overlay` resolves the hint to a `GdkMonitor` (connector/model, or centre-then-largest-overlap) and calls `set_monitor` *before* mapping when a hint already exists (`overlay.rs` 284–296, 540–555).
- A Settings override is passed through as `--output` and is not overridden (`lock_output`).
- Repeat pins to the same monitor key are skipped.

#### What is still open

1. A first `Show` can be emitted **before** bounds or output names arrive (`focused_hint` is then `None`). The surface maps on KWin’s default, which is `activeOutput()` — still the Roxysu monitor if the user just clicked the app. A later bounds event emits a new `Show` and pins, but that is `set_monitor` on an already-mapped surface (D1).
2. Plasma `geometry` and `client_geometry` both write `Bounds`; last event wins. Both are “absolute coordinates,” so they should usually agree on the monitor. Fractional scaling can still make Plasma coordinates disagree with `GdkMonitor.geometry()` (logical pixels). Unverified.
3. If no Gdk monitor matches the hint, the code logs and leaves the surface where KWin put it.

#### Impact

The common “HUD on the Roxysu display” bug should fix itself once geometry arrives, except for a possible wrong first frame and a pin-after-map glitch. A Settings connector remains a reliable escape hatch (M7).

#### Repro

Two monitors, Roxysu on A, osu! fullscreen on B. Start the overlay, confirm the pin log (`pinned overlay to osu! output`). Drag osu! A↔B. Repeat with an empty Settings monitor and with `DP-x` filled in.

#### Proposed patch

1. Do not `present()` until a hint exists, or map hidden / off-screen until the first pin (fail-closed for placement, not only for focus).
2. Unmap → `set_monitor` → remap (same as D1).
3. Prefer `geometry` over `client_geometry` for monitor picking (decorations included, same space) *or* ignore one consistently.
4. Log both the Plasma rect and the chosen `GdkMonitor` connector/scale so a fractional-scale mismatch is obvious.

#### Trade-offs

Waiting for a hint delays the first map by a frame or two; that is better than a flash on the wrong display plus a surface recreate.

#### Tests

Reducer already tests bounds and output-name changes. Add a unit test that `find_monitor_for_rect` prefers containment then overlap (extract the pure geometry helpers). Manual two-monitor Plasma test as above. Not run here.

---

### M3 — Possible memory leak

**Severity:** Medium | **Status:** **Open**

Still no confirmed leak in source. The watchdog still tracks descendant RSS / FDs (not host RSS), and the desktop still passes `--watchdog-max-age-sec=0`, so a slow climb never forces a recycle. Hide-by-unmap (if H1 works) should drop compositor/GPU memory while WebKit RSS may stay until a reload — same story as before.

**New suspicion (N2):** Plasma window proxies and wlr foreign-toplevel handles may not send `destroy`, so the focus connection can accumulate protocol objects over a long session. That is a leak of Wayland object ids, not the multi-hundred-MiB WebKit tree the user is likely seeing.

No RSS soak was run on this box. Do not treat this paragraph as a measurement.

#### Proposed patch

Keep the existing “measure first” plan (tree RSS while mapped vs unmapped, vs after a reload). Call `destroy()` in N2. Reconsider a long-session age cap only after D1/D2, or raise it rather than leaving it at 0 forever.

---

### M4 — Overlay does not follow osu! to another monitor

**Severity:** Medium | **Status:** **Partly fixed**

`output_enter` / `output_leave` are applied; a hint change while already shown emits a new `Show`; `pin_overlay` moves the surface. Tests cover both name and bounds moves.

Residual: **N4** — outputs are bound only at session start. A newly plugged monitor never gets a `Name`, so niri `OutputEnter` for that output sits in `pending_outputs` forever and no hint is emitted. Plasma uses geometry against the GTK monitor list, which *should* see hotplug; niri is the one that needs the focus connection to bind new `wl_output`s.

`set_monitor` on a mapped surface is still the D1 risk.

---

### M5 — Title is ignored when `app_id` is non-empty

**Severity:** Medium | **Status:** **Open** (deliberate, but higher impact)

`matching.rs` is unchanged in policy: prefer `app_id`; use `title` only when `app_id` is empty; `resource_name` is not a haystack. Tests now *document* that `dotnet` + title `osu!` does not match. That is correct for “a Firefox tab titled osu! must not show the HUD,” but on Plasma, lazer or a Wine/XWayland client may have a generic `app_id` and a useful `resource_name` or title.

Previously, a match failure on Plasma still showed the HUD (always-visible fallback). Now it stays unmapped. **Do not widen the matcher until `--list-windows` on the user’s Plasma session prints the real fields** (and until N3 is fixed so that dump is trustworthy).

---

### M6 — Minimized / other desktop are not first-class hide conditions

**Severity:** Medium | **Status:** **Partly fixed**

Minimized is first-class (`activated && !minimized`) on both backends, with a reducer test. Plasma virtual-desktop and activity events are swallowed by `_ => {}`. If KWin drops `Active` when the window is on a hidden desktop, hide already works; if not, the HUD will stay up on an empty (or other) desktop. Treat “switch Plasma virtual desktop with osu! left behind” as a required manual test before closing this.

---

### M7 — Settings / desktop never pass `--output`

**Severity:** Medium | **Status:** **Fixed**

- `OVERLAY_HOST_OUTPUT_KEY = "overlay.host_output"`.
- `parseOverlayOutput` rejects empty, leading `-`, and control characters (so a value cannot become a second flag). Spawn uses `shell: false` and a single `--output=` token.
- Settings UI has Save monitor / Follow osu!.
- `decideOverlayApply` restarts on output change; tests cover it.
- Desktop stores `overlayAppliedOutput` and includes it in the spawn argv.

Residual UX is under L8 (free-text, no picker). Residual safety: the desktop still does not re-validate `hostUrl` before argv (older desktop finding). Not re-opened as a new overlay-host bug.

---

### M8 — Hide→show over fullscreen osu! may need a layer reassert

**Severity:** Medium | **Status:** **Open**

`diagnostics::on_show` still only bounces `TOP` → `OVERLAY` when `--diag-reassert-placement` is on. After H1 works, this is the test to run on KWin exclusive fullscreen. Do not enable the bounce by default until that test fails.

---

### L1 — `run.sh` hardcodes `--output=DP-4`

**Status:** **Fixed.** `--output` is added only when `ROXYSU_OVERLAY_OUTPUT` is set.

### L2 — Default 1920×1090 WebKit surface

**Status:** **Open.** `DEFAULT_WIDTH = 1920`, `DEFAULT_HEIGHT = 1090`. Still a D1/configure fight and a performance cost. The deep-dive recommendation (size to the output or to the HUD bbox) was not started.

### L3 — Unbounded focus channel

**Status:** **Open.** `async_channel::unbounded` in `start_focus_tracking`. A stuck GTK loop can still queue an unbounded number of Show/Hide/pin commands.

### L4 — Focus thread is not stopped on shutdown

**Status:** **Fixed.** `FocusHandle::stop` sets a flag and joins; `Drop` does the same; `app.connect_shutdown` takes the handle and stops it. The pump polls every 500 ms, so join can wait up to one timeout. Acceptable.

### L5 — Docs claim KDE support

**Status:** **Fixed.** The knowledge page now describes the Plasma global as privileged, the `.desktop` grant, fail-closed first connect, output pinning, and observe-only rules. That matches the new code (with the N1 caveat that “before connect” is true for the *focus* connection, not for the earlier GTK connection).

### L6 — `contains` + needle `osu` can false-positive

**Status:** **Open.** Still the default. `short_needle_can_false_positive_under_contains` documents `bosun`. `--match-mode exact` remains the tightening switch; it is not in Settings.

### L7 — `--list-windows` is wlr-only

**Status:** **Partly fixed.** The same `bind_backend` is used, and the dump includes `resource_name`. See **N3** for the incomplete-dump bug. The 3 s timeout warning still says “foreign-toplevel dump” (`overlay.rs` 205).

### L8 — Settings UI is enable + URL only

**Status:** **Partly fixed.** Monitor was the missing host flag and is now present. Residuals: free-text connector (placeholder `DP-4`), no enumeration of Gdk/Wayland outputs, no match-policy or size controls.

---

## New issues

### N1 — KWin grant may not be live for the first focus connection

**Severity:** High (Plasma follow-focus can stay unmapped) | **Status:** **New**

#### Root cause

KWin only advertises `org_kde_plasma_window_management` to a client whose canonical `/proc/self/exe` matches a `.desktop` `Exec=` that lists the interface in `X-KDE-Wayland-Interfaces`. The host does the right *kind* of thing:

- `install_plasma_grant()` writes `~/.local/share/applications/dev.roxysu.overlay.desktop` with `Exec=` = `canonicalize("/proc/self/exe")` (so Nix wrappers and Electron copies are rewritten), then runs `kbuildsycoca6` / `kbuildsycoca5` when the body changed (`grant.rs`).
- The Nix package also installs a store-path `.desktop` (`nix/overlay-rs.nix`).
- Grant install runs in `run_app` before `OverlayHost::present_initial` starts the focus thread (`main.rs` 121–122). The GTK/`zwlr_layer_shell` connection has already been created by `Application::run`. That is fine: the privileged global is only needed on the **second** connection.

Gaps:

1. **Sycoca / KWin cache timing.** `kbuildsycoca` is run and the focus thread then connects immediately. If KWin does not reload the grant until a later cache read, the first bind sees `NotPresent`, emits `Unavailable`, and stays unmapped. The loop retries with 1 s … 30 s backoff, which should eventually work *if* KWin notices. This was not measured.
2. **`kbuildsycoca6` may not be on PATH.** The Nix overlay derivation does not wrap `kbuildsycoca6` into the binary’s PATH. A Nix-packaged Electron app often has a minimal PATH. `refresh_sycoca` then logs and returns false. The file is on disk, but KWin may not see it until the next login or a manual rebuild. Every Plasma session then stays fail-closed.
3. **Nix `Exec=` vs `/proc/self/exe`.** The packaged desktop file points at `$out/bin/roxysu-overlay-rs`, which may be a `wrapProgram` script, while `/proc/self/exe` is the `-wrapped` binary. The runtime rewrite is what makes this work; it must actually run, and KWin must then see the *user* desktop file.

The grant body itself is conservative and well tested (`NoDisplay`, no `close` in `X-KDE-Wayland-Interfaces`, quoted paths with spaces). That part is good.

#### Impact

The user-visible Plasma bugs can persist after this commit, but as “overlay never appears” instead of “wrong monitor / doesn’t hide.” Logs will say the protocol is unavailable and mention the desktop file.

#### Repro

On a clean Plasma user account (no existing `dev.roxysu.overlay.desktop`), start the desktop app once. Check whether the first focus connection binds. `ls ~/.local/share/applications/dev.roxysu.overlay.desktop`, whether `kbuildsycoca6` is on the overlay process PATH, and `WAYLAND_DEBUG` / host logs for `backend=org_kde_plasma_window_management`. Repeat from a Nix-wrapped Electron build.

#### Proposed patch

1. Keep writing the user desktop file at startup (needed for copied binaries).
2. If `kbuildsycoca*` is not on PATH, log a concrete install hint; consider adding `kbuildsycoca6` to the Nix-wrapped desktop/overlay PATH.
3. After a successful cache rebuild, **delay or immediately retry** the first focus connect (one extra reconnect after install, without a 30 s backoff).
4. Optionally: if the grant file was just written, treat the first `NotPresent` as “grant not yet visible” and retry at 200–500 ms for a few seconds.

#### Trade-offs

A short first-start delay on Plasma is fine. Do not fail *open* if the grant never appears.

#### Tests

`desktop_entry` unit tests already exist. Add a test that the written `Exec` equals a wrapped path with spaces/backslashes. Manual: first-run Plasma, and a Nix-wrapped launch where `kbuildsycoca6` is / is not on PATH.

---

### N2 — `seen_plasma` leak and missing `destroy` requests

**Severity:** Medium | **Status:** **New**

#### Root cause

`adopt_plasma_window` keys `seen_plasma` by KWin’s **internal** window id and refuses a second `get_window`. On `Unmapped` it removes the proxy from `plasma_windows` and sends `Closed` to the reducer, but:

- it never removes the internal id from `seen_plasma` (and does not even store the internal id next to the protocol object);
- it never calls `OrgKdePlasmaWindow::destroy()` (“remove resource for the org_kde_plasma_window”). Dropping the Rust proxy in wayland-client 0.31 does not reliably send that request.

The wlr path has the same class of bug: `Closed` is applied to the reducer, but the `ZwlrForeignToplevelHandleV1` is never stored and never `destroy`ed.

If KWin reuses an internal id after osu! is closed (or, for some XWayland clients, if `Unmapped` were ever sent on minimize — unverified; native minimize should be a state bit only), the next `Window` / `WindowWithUuid` is ignored. Follow-focus then never sees the new osu! window.

#### Impact

After an osu! restart, or over a long session with many windows, Plasma follow-focus can silently die until the overlay process restarts. Protocol objects can also accumulate (a small leak, distinct from WebKit RSS).

#### Repro

On Plasma, start osu!, confirm the HUD, quit osu! completely, start it again, without restarting the overlay. If the HUD never returns and `--list-windows` (after N3) also misses the new window, this is the bug.

#### Proposed patch

1. Store `internal_id` (and uuid) with the proxy.
2. On `Unmapped`: `window.destroy()`, remove from `plasma_windows`, **remove from `seen_plasma`**, then `Closed`.
3. Store wlr handles and `destroy()` them on `Closed`.
4. Prefer `get_window_by_uuid` whenever a uuid is present (already done when `version() >= 12`).

#### Trade-offs

None meaningful; this is protocol hygiene.

#### Tests

A small `seen_plasma` state machine test: adopt id 5, unmap, adopt id 5 again, expect a new `Added`. Requires extracting the adopt/unmap logic from the Wayland dispatch.

---

### N3 — `--list-windows` can dump empty app_id / title

**Severity:** Medium | **Status:** **New**

#### Root cause

```297:306:apps/overlay-rs/src/focus/wayland.rs
    for _ in 0..8 {
        queue.roundtrip(session).context("wayland roundtrip")?;
        session.flush_batch();
        if session.list_only && !session.reducer.toplevels().is_empty() {
            break;
        }
        if !session.list_only {
            break;
        }
    }
```

The list path breaks as soon as **any** toplevel has been `Added`. On Plasma, `Window` / `get_window` usually fills `toplevels` in the first roundtrip, while `AppIdChanged`, `TitleChanged`, `ResourceNameChanged`, and `InitialState` arrive in a later one. The dump then prints empty fields. The live path is safer (four extra roundtrips after the first). This is the command the docs tell the user to run before changing M5.

#### Impact

A Plasma user debugging “overlay never shows” can conclude the window is missing or has an empty `app_id` when it does not.

#### Repro

`roxysu-overlay-rs --list-windows` on Plasma (and niri). If lines look like `* app_id='' title='' resource_name=''`, wait; compare with a build that always performs all eight roundtrips or waits for a quiet `InitialState`.

#### Proposed patch

Do not break on the first non-empty map. Either always run the eight roundtrips, or dump only after a roundtrip with no new property events (or after every known plasma window has received `InitialState`). Also fix the timeout log string (`overlay.rs` 205).

#### Trade-offs

`--list-windows` may take a few hundred ms longer. Fine.

#### Tests

A reducer/session test is hard without a compositor. A unit test around “dump only when every toplevel has a non-empty app_id or title, or InitialState was seen” is feasible if that condition is extracted.

---

### N4 — Focus connection ignores `wl_output` hotplug

**Severity:** Medium | **Status:** **New** (was implicit in M4)

#### Root cause

`bind_outputs` runs once. `Dispatch<WlRegistry, GlobalListContents>` is an empty `event` function (`wayland.rs` 433–443). A new output advertised after start is never bound, never named, and `OutputEnter` for it stays in `pending_outputs`.

Plasma pinning via `OutputHint::Rect` + `GdkMonitor` can still work, because GTK’s monitor list updates independently. niri relies on names.

#### Proposed patch

On registry `global` for `wl_output`, bind it (v4 when possible) and keep the existing `Name` / `Geometry` path. On `global_remove`, drop the name and emit `OutputLeave` for any toplevel that was on it.

#### Tests

Manual: plug in a monitor, move osu! to it, confirm a pin log. Not run here.

---

## New Plasma / desktop code — review notes (not all are bugs)

These are observations on the new implementation that did not rise to their own IDs, or that support the items above.

**Protocol bind range.** `globals.bind(..., 7..=18, ())` (`wayland.rs` 368). Current protocol text says this global “must be bound with a version at least 17.” wayland-client will bind the highest version in the intersection, so on a modern KWin advertising 18+ the host binds 18, which is fine. `client_geometry` exists only since 18, so the ceiling is intentional given `wayland-protocols-plasma` 0.3.12. Raise the floor to 17 to match the spec, and raise the ceiling if the crate gains v19+. Binding 7 would be wrong; it should not happen against current KWin.

**`Window` vs `WindowWithUuid`.** Both may fire. Dedup by internal id is correct. Prefer uuid when present (already done at version ≥ 12). `get_window` is deprecated; it remains a valid fallback when only the numeric event arrives.

**Geometry vs client geometry.** Both write the same `Bounds`. Both are absolute coordinates; client geometry is “without decorations.” For monitor picking they should usually agree. Prefer one (see H2) so a last-event flicker cannot change the hint.

**Virtual desktop / “show desktop” / activities.** Ignored. See M6. `show_desktop_changed` is also ignored; if “Show Desktop” does not minimize osu!, the HUD may stay.

**State bitfield.** Correct. `Shaded` is not treated as hidden (minor).

**`parent_window`** is an existing-object argument, not a `new_id`, so the missing `event_created_child!` is fine.

**“Only one client can bind.”** Still in the XML. Not treated as a confirmed blocker (see limits above). If bind fails *with* a live grant, inspect this first.

**Fail-closed.** `visibility_after_unavailable` is an identity function; the real fail-closed behaviour is that `wants_visible` starts `false` and `Unavailable` does not set it true. `Disconnected` leaves visibility unchanged and reconnects — reasonable, but a KWin restart can leave a stale HUD up until the next batch.

**Pin skip.** Good. Combined with “don’t present until hinted” it becomes safe.

**Grant tests.** Good coverage of the desktop-entry body; no test for “do not grant `close`” beyond `assert!(!text.contains("close"))`, which is brittle but currently true.

**Desktop output validation.** Server-side `parseOverlayOutput` is tight enough for argv. The desktop shell trusts `/api/settings` and does not re-parse. Acceptable if the server is local and already validates PATCH.

**Settings UX.** Free-text monitor box is enough for a first cut (M7). A picker can wait.

---

## Deep-dive roadmap — what landed, what did not

Against `/workspace/Roxysu-overlay-deep-dive.md`:

| Deep-dive item | At `0d84595` |
|----------------|--------------|
| 1.3 Privileged `.desktop` grant | Landed (N1 residuals) |
| 1.4 Matching lazer / XWayland / Wine | Dump of `resource_name` only; policy unchanged (M5) |
| 1.5 Output selection, hotplug, scale | Name + geometry pin landed; hotplug (N4) and scale observer did not |
| 1.6 Fail-closed | Landed |
| 1.7 Backend trait / connect order | wlr then Plasma, reconnect with backoff — landed in spirit (no formal trait) |
| 2.3 Cheap WebKit (size clamp, feature flags) | Not started (L2 open) |
| 2.4 Replace the WebView | Still backlog |
| 3.1 Observe the surface contract | Not started (D1) |
| 3.2 Recreate WebView on web-process death | Not started (D1) |
| 3.3 Heartbeat page → host → Electron | Not started |
| 3.4 Graceful restart, no overlapping surfaces | Not started (D2) |
| 3.5 Watchdog / crash reporting | Age cap still forced to 0 |
| 3.6 Tests | Substantially more unit tests for grant / matching / reducer / output policy. No compositor integration tests. `cargo test` was not runnable here. |

The biggest product win in this commit is H1/H2 *if* N1 and M5 do not fire. The biggest remaining user-facing hole is still D1, and D2 can still cause it on a Settings save.

---

## Prioritized fix plan

### 1. Immediate (about a day)

1. **D2.** Mutex around `apply()`, `await stopChild()` before spawn. This is desktop-only and unblocks safe URL/monitor restarts.
2. **N3.** Make `--list-windows` wait for `InitialState` / a quiet roundtrip. Fix the timeout log wording.
3. **D1 logging only.** Log configure size, monitor scale, every `set_monitor`, and web-process death. Ship this so a real Plasma/niri session can confirm which D1 branch it is.
4. **N1.** Retry the first Plasma bind after writing the grant; put `kbuildsycoca6` on the packaged PATH; keep fail-closed.

### 2. Next (about a week)

5. **D1 behaviour.** Unmap → pin → remap on output change; do not map until an output hint exists (H2 residual); size the surface to the output (L2); recreate the `WebView` (and ideally the layer surface) after `web-process-terminated`.
6. **N2.** `destroy()` + clear `seen_plasma`; destroy wlr handles on `Closed`.
7. **N4.** Bind `wl_output` globals that appear later.
8. **Manual Plasma pass** with a fixed `--list-windows`: grant first-run, alt-tab, minimize, virtual desktop, two monitors, osu! restart, exclusive fullscreen (M8 if it fails). Only then touch **M5** if the real `app_id` would miss.

### 3. After the above has been soaked

9. M8 only if hide→show over fullscreen fails on KWin.
10. L3 bounded focus channel.
11. Performance pass from the deep dive (HUD bbox, WebKit flags). Measure on a real session; do not guess RSS.
12. Heartbeat and a less violent age-cap policy than “never.”
13. Replacing WebKit remains backlog.

### Suggested sequence

D2 → N3 → D1 logs → N1 → (user Plasma dump) → D1 unmap-before-pin + size-to-output + WebView recreate → N2 → N4 → M5 only if needed → M6/M8 only if the manual matrix fails.

---

## Review limits, restated

Nothing in this document is a runtime measurement. GTK/WebKit headers and a compositor were not available, so `cargo test` / `cargo check` were not feasible. Protocol remarks use the public Plasma window-management text and the cited source lines. The user’s Plasma and drift/noise bugs should be re-checked on a real session after D2, N1, and N3, with the new configure/`set_monitor` logs from D1 step 3.

