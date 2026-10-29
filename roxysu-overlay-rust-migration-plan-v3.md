# Rust Migration Plan (v3): `roxysu-overlay`

> **Status (2026-10):** Migration complete. C host removed; Rust (`apps/overlay-rs`)
> is the only implementation. This document is historical.

> Revision notes: the C code is now treated as a frozen, tagged baseline and rollback target (no C fixes). The plan adds a full workaround inventory, a C-side A/B test, a C behavior table, event batching for focus, an explicit matching policy, a dedicated Wayland connection, retry coalescing, and more robust memory measurement.

## 1. Goal

Replace the native `roxysu-overlay` host (C, GTK4 + WebKitGTK + gtk4-layer-shell + wlr-foreign-toplevel) with a Rust implementation that preserves HUD behavior while improving memory safety, observability, and reliability.

Key distinction to preserve:

- **HUD content updates frequently.** Live gameplay data may change many times per second. The existing web frontend and data pipeline keep their cadence.
- **Native window management changes rarely.** Focus, visibility, monitor placement, and layer-shell state should react to events, never to timers.

The goal is not to slow the HUD down. It is to remove redundant forced native redraws and layer/opacity churn while keeping WebKit rendering responsive.

Keep the existing web HUD and Bun-based Roxysu app unless a concrete integration issue requires a change. This is a staged migration, not a redesign.

## 2. Architecture: separate data rendering from window management

```text
Gameplay data / WebSocket / existing Roxysu data source
                         |
                         v
             Existing web HUD / WebKit
       frequent content updates and browser rendering
                         |
           redraw when content/layout changes

Wayland foreign-toplevel events (dedicated connection/thread)
             |
             v
   Focus reducer (pure, unit-testable)
   batch events -> evaluate once per dispatch
             |
     visibility state actually changes?
        /           \
      no             yes
      |               |
   do nothing    Show/Hide command -> GTK main thread

Monitor/configuration/recovery events
             |
             v
    update layer-shell/window placement
    only when necessary
```

Required behavior:

- Preserve the current gameplay data cadence unless measurement identifies a specific problem.
- Let WebKit/GTK render normally when HUD content changes.
- No periodic opacity toggles, `queue_draw()`, injected keepalive animations, or layer-shell reassertion in the default path.
- Keep each legacy workaround behind a separate temporary diagnostic flag, and test each independently.
- If removing a workaround causes stale frames, vanishing content, or fullscreen issues, reproduce and document the exact condition before restoring a targeted fix.

Frequent WebKit content changes can legitimately cause frequent rendering. The aim is to eliminate *redundant forced* redraws, not legitimate ones.

## 3. Legacy workaround inventory (from the C code)

Verified against `apps/overlay/main.c` at tag `c-baseline` (`e393b360`). Live symptom/repro status is in [`findings/overlay-c-phase0-baseline.md`](findings/overlay-c-phase0-baseline.md).

| # | Mechanism | Where (symbol) | What it does | Suspected purpose | Observed symptom / repro | Rust default |
|---|---|---|---|---|---|---|
| W1 | `damage_tick` | `damage_tick` + `g_timeout_add(300, …)` only when follow-focus + foreign-toplevel OK (~880) | Flips view opacity 1.0 ↔ 0.999, `queue_draw`, requests frame-clock paint | Force compositor to keep presenting frames above fullscreen games (knowledge rule 10; NVIDIA fd/RSS churn) | **A/B 2026-10-29 niri:** not needed for static visibility with `--follow-focus 0` (probe + HUD layer visible windowed/fullscreen). Live-update churn still to prove in Phase 3. | Off (diagnostic flag) |
| W2 | `inject_keepalive` | `inject_keepalive` from show path in `apply_visibility` (~309) | Injects CSS `html` opacity animation 0.99998 ↔ 1 every 0.2 s, infinite | Keep WebKit producing frames so live HUD updates recompose | **A/B:** same as W1 — unused on always-visible path; removal candidate | Off (diagnostic flag) |
| W3 | `reassert_placement` | `reassert_placement` on first show (~307) and throttled refocus (~291–298); `REASSERT_MIN_INTERVAL_US` = 1 s | Re-sets anchors, bounces layer TOP → OVERLAY, `queue_draw` | Stay above fullscreen osu!lazer after remap (F-039 / knowledge rule 9) | Not exercised with `--follow-focus 0`; keep for focus remap until Phase 4 validates | Only on map/re-map if proven needed |
| W4 | `paint_counter` tick callback | `paint_counter` via `gtk_widget_add_tick_callback` always (~871); `--debug` → `debug_report` every 5 s | Counts tick callbacks (not true paints); keeps frame clock running | Debug stat with hidden continuous frame-clock side effect | Always installed during A/B; visibility did not depend on it → removal candidate unless `--debug` | Off unless `--debug`; test removal |
| W5 | `set_page_hidden` JS | `set_page_hidden` on show/hide in `apply_visibility` (~308, ~312) | Toggles `documentElement.style.visibility` | Soft visual hide before unmap; avoid stale frame | Soft-only hide failed historically (knowledge rule 8); still paired with unmap; evaluate on focus path | Evaluate; prefer native hide only |
| W6 | Explicit `set_visible(TRUE)` before `present()` | show path in `apply_visibility` (~305–306) | Undoes hide before `gtk_window_present` | GTK4 layer-shell remap bug (F-039) | Keep for follow-focus show path | Keep, document, test |
| W7 | `--gsk-renderer`, `--webkit-no-dmabuf` | CLI → `GSK_RENDERER` / `WEBKIT_DISABLE_DMABUF_RENDERER` (~782–785) | Force GSK renderer / disable DMA-BUF | GPU/compositor crash and glitch avoidance | All matrix cells passed on niri 2026-10-29; keep as config | Keep as config |

Rows without a reproducible symptom after the Phase 0 A/B are candidates for removal in Rust.

## 4. Candidate Rust stack

| Concern | Candidate | Validation required |
|---|---|---|
| Language/build | Rust + Cargo | Pin a tested toolchain. |
| CLI | `clap` | Preserve flags and defaults; see CLI notes below. |
| GTK4 | `gtk4` bindings | Verify against the target GTK4 version. |
| WebKitGTK | `webkit6` crate (GTK4) | Verify crate/native compatibility on NixOS. |
| Layer-shell | `gtk4-layer-shell` bindings | Prove anchors, overlay level, monitor selection, transparency, click-through. |
| Wayland client | `wayland-client` + `wayland-protocols-wlr` | Confirm `zwlr_foreign_toplevel_manager_v1` support (niri and others). |
| Logging | `tracing` | Log lifecycle, focus, retries, memory samples. |
| Errors | `anyhow` / typed errors | No silently ignored init failures. |
| Memory | Linux `/proc`, cgroup files; optionally `procfs` | Distinguish host, WebKit, tree, and cgroup totals. |

Do not commit to the entire stack before the prototype phase. If a binding lacks an API, isolate minimal FFI in one documented module.

## 5. Proposed modules

```text
src/
  main.rs
  cli.rs
  config.rs
  app.rs
  diagnostics.rs
  error.rs
  overlay/
    mod.rs
    window.rs
    layer_shell.rs
    click_through.rs
  focus/
    mod.rs
    wayland.rs        # dedicated connection + dispatch loop
    reducer.rs        # pure state machine: events -> Show/Hide
    matching.rs       # match policy
  webview/
    mod.rs
    lifecycle.rs      # single reload state machine with backoff
  telemetry/
    mod.rs
    memory.rs
    cgroup.rs
    sampling.rs
  watchdog/
    mod.rs
    process_tree.rs
    policy.rs
```

Threading rules:

- GTK/WebKit objects stay on the GTK main thread.
- The Wayland focus connection runs on its own thread (or its own event source) and sends `Show`/`Hide` commands to the GTK thread over a channel.
- Telemetry and watchdog scans run off the GTK main loop and never touch GTK/WebKit objects.

## 6. Migration phases

### Phase 0 — Freeze baseline (no C fixes)

The C implementation is **not modified**. It is the baseline and the rollback.

- [x] Tag the current C commit (for example `c-baseline`) and archive the built binary.
- [x] Record CLI flags, defaults, URL, target app ID/title, dimensions, opacity, monitor behavior, click-through.
- [x] Fill in the C behavior table (section 6a).
- [x] Complete the workaround inventory (section 3) with symptoms and repro recipes.
- [x] Run the **C A/B render test** (section 6b).
- [x] Capture baseline RAM, CPU, and behavior (soak configuration below). See [`findings/overlay-c-phase0-baseline.md`](findings/overlay-c-phase0-baseline.md).
- [x] Identify the overlay PID and its WebKit child processes.
- [x] Document the current NixOS build and launch process.

Known C quirks (documented, not fixed; each becomes a Rust test or decision):

- The argument expander splits **every** argument containing `=` into key and value, including values. `--url "http://host/#/overlay?bg=clear&limit=25"` is split and rejected (exit 2). Rust must accept both `--url=VALUE` and `--url VALUE`, with `=` inside values untouched.
- The expander uses fixed arrays (`key_storage[128][256]`, `expanded[256]`) indexed by argument position. It is only reachable with an unrealistic argument count and is retired by `clap`.
- `--help` claims the default output is the cursor output; the code defaults to compositor choice (`output == NULL`). Rust must implement it or document the real default.
- `--opacity`, `--width`, `--height` silently fall back to defaults on invalid input; `--margin` accepts anything `atoi` returns. Rust should validate and report.
- Default anchor is top-right; the margin applies to all four edges.
- The watchdog exits with code **0**, so a `Restart=on-failure` service policy will not restart it.

#### 6a. C behavior table

| Behavior | Observed in C | Intentional? | Rust decision |
|---|---|---|---|
| Visibility rule (matched window focused) | With `--follow-focus 1`, `recompute_focus` → `apply_visibility(match_focused)`: show only while a matching toplevel has `STATE_ACTIVATED` | Yes | Preserve; batch per dispatch (Phase 4) so alt-tab does not spuriously hide |
| Match rule (app_id substring; title only if app_id empty) | `toplevel_matches`: case-insensitive substring of `--match-app-id` (default `osu`) in `app_id`; title checked only when `app_id` is null/empty | Yes | Preserve as default `contains`; optional exact/regex later; guard short false positives |
| Behavior when no matching window exists | Hide (`apply_visibility(0)`); one-time stderr "waiting for a focused window matching …" | Yes | Preserve hide + clear log |
| Behavior when compositor lacks foreign-toplevel | `ft_init` fails → stderr notice → `gtk_window_present` always visible (same as `--follow-focus 0`) | Yes | Preserve always-visible fallback; define reconnect if connection drops later |
| Hide implementation (JS visibility + unmap) | `set_page_hidden(1)` then `gtk_widget_set_visible(FALSE)`; soft opacity-only hide abandoned | Yes (hard map/unmap required) | Prefer native unmap; keep W5 only if A/B shows stale frames without it |
| Reload delays (web crash 1 s; load fail 3 s, then 15 s after 5 failures) | `on_web_process_terminated` → 1 s; `on_load_failed` → 3 s / 15 s after `g_load_failures > 5`; reset on `WEBKIT_LOAD_FINISHED` | Yes | Single reload state machine with same delays; no stacked timers |
| Watchdog caps (1800 s age, 450 FDs, 4200 MB tree RSS) and exit code | Every 20 s; tree RSS is **descendants only** (host excluded); breach → log → **`exit(0)`** | Intentional for desktop poll respawn; exit 0 defeats `Restart=on-failure` | Non-zero exit or documented service policy; reconsider unconditional 30 min exit after measurement |
| Click-through reapplied on every `map` | `map` → `apply_click_through`: empty `wl_region` via `wl_surface_set_input_region`; keyboard mode `NONE` | Yes | Reapply on every map; verify after hide/show |

#### 6b. C-side A/B render test (do this first)

With `--follow-focus 0`, the C build never installs W1, W2 or W3 (they all sit on the focus path). Run it under:

- niri windowed osu!lazer, and niri **fullscreen** osu!lazer;
- renderer x DMA-BUF matrix: default, `--gsk-renderer ngl|gl|cairo|vulkan`, `--webkit-no-dmabuf`.

Observe: stale frames, vanishing HUD, flicker, z-order under fullscreen. If the HUD renders correctly without the hacks, the workarounds are strong removal candidates. If not, the failing condition becomes the reproduction case for Rust.

#### RAM baseline procedure

Use the same HUD content, monitor, compositor, resolution, and gameplay scenario for C and Rust. Because the C watchdog exits after 1800 s, raise `ROXYSU_WATCHDOG_MAX_AGE_SEC` (and, if needed, `ROXYSU_WATCHDOG_MAX_FDS` / `ROXYSU_WATCHDOG_MAX_RSS_MB`) for soak runs, and record those values. Otherwise a 60–120 minute soak cannot finish.

Measure these stages:

1. Startup and after the HUD has loaded.
2. At least 5 minutes idle with the HUD open.
3. 20–30 minutes of active gameplay.
4. Repeated focus changes between osu!lazer and another window.
5. A 60–120 minute soak, if practical (with raised watchdog caps).
6. Recovery after the HUD server becomes unavailable and returns.
7. Recovery after a WebKit web process terminates, if safely reproducible.

Record timestamp, phase, host PID, process-tree membership, host RSS/PSS, WebKit process RSS/PSS, aggregate tree RSS/PSS, cgroup memory (if available), peak/end memory, and optional CPU.

**Do not treat summed RSS as exact physical memory.** RSS can count shared pages more than once; prefer PSS. Report host-only and process-tree figures separately. Note that the C watchdog's "tree" totals exclude the host process itself, so its numbers are not directly comparable to Rust telemetry.

The C watchdog caps (450 FDs, 4200 MB) suggest past incidents. Treat them as hypotheses to confirm, and ask what originally triggered them.

### Phase 1 — Prove the critical Rust integrations

- [x] Small Rust prototype on a separate branch. (`overlay-rust-phase1`, crate `apps/overlay-rs`)
- [x] Transparent GTK4 layer-shell window.
- [x] Embed WebKitGTK and load the live HUD.
- [x] Verify transparency and click-through, **including a hide/show cycle** (the input region must survive remap).
- [x] Verify layer, anchors, size, and monitor selection.
- [x] Prototype foreign-toplevel tracking on a dedicated `wayland-client` connection and observe osu!lazer activation.
- [x] Check whether GDK's surface input-region API can replace the raw `wl_compositor` binding used in C. (**Yes — `GdkInputRegion`.**)
- [x] Confirm native libraries and bindings build reproducibly on the target NixOS setup.
- [x] Document missing APIs or protocol limitations. See [`findings/overlay-rs-phase1.md`](findings/overlay-rs-phase1.md).

**Exit criteria:** the prototype renders the live HUD, stays click-through after hide/show, and receives focus events on the target setup. Do not begin the full port before this. **Met 2026-10-29.**

### Phase 2 — CLI and configuration

- [x] Implement `clap` parsing; preserve option names and defaults. (`apps/overlay-rs/src/cli.rs`)
- [x] Accept `--opt value` and `--opt=value`; leave `=` inside values alone (unit test with a URL containing `?bg=clear&limit=25`).
- [x] Typed fields for URL, match policy, dimensions, opacity, anchor, margin, monitor, thresholds. (`config.rs`)
- [x] Validate URL, numeric ranges, and conflicting options; error on invalid values instead of silently defaulting.
- [x] Expose `--gsk-renderer` and `--webkit-no-dmabuf` as typed options.
- [x] Keep `--list-windows`, `--debug`, `--follow-focus`.
- [x] Add diagnostic flags for W1–W5 (default off). (`--diag-*`; behavior wired in Phase 3)
- [x] Ensure help text matches real behavior; implement cursor-output selection or document the real default. (documented: compositor default)
- [x] Unit tests for valid and invalid configuration. (13 tests)

### Phase 3 — Native overlay and live WebKit rendering

- [x] GTK4 window and layer-shell configuration. (Phases 1–2; retained)
- [x] Load the existing HUD without changing its data source or cadence. (HTTP-only `load_uri`)
- [ ] Verify rapid gameplay-data changes stay visible and responsive. (manual live check; see findings)
- [x] Remove W1–W4 from the default path; keep each behind its own diagnostic flag. (`--diag-*`; `--debug` ⇒ W4)
- [ ] Compare each workaround individually under niri, especially fullscreen osu!lazer, across the renderer x DMA-BUF matrix. (manual)
- [x] Log WebKit load failures and web-process termination.
- [x] Implement a **single reload state machine**: one pending-reload slot (no stacked timers from `load-failed` plus `web-process-terminated`), bounded backoff, reset on load finished. (`reload.rs`)
- [x] Clean shutdown. (drop `ApplicationHoldGuard` on `shutdown`; GApplication SIGINT/SIGTERM)

**Exit criteria:** the HUD stays responsive without timer-driven redraw hacks. If it fails, the failure is reproducible and tied to a specific rendering/compositing condition.

### Phase 4 — Event-driven Wayland focus tracking

- [x] Dedicated Wayland connection for `zwlr_foreign_toplevel_manager_v1`. (`focus/wayland.rs`)
- [x] Pure focus reducer: toplevel add/update/close events in, `Show`/`Hide` commands out. (`focus/reducer.rs`)
- [x] **Batch events:** evaluate once per dispatch batch rather than on every `done`, so alt-tab between windows does not cause a transient "nothing matched" hide/show cycle. Optionally add a short, measured hysteresis on hide. (`end_batch` + `--hide-hysteresis-ms` default 80)
- [x] Apply window-state changes only when the computed visibility changes.
- [x] Define the match policy explicitly (see below) and test it. (`focus/matching.rs`; `--match-mode contains|exact`)
- [x] Handle missing app IDs, title changes, window destruction, and osu!lazer restarts.
- [x] Handle protocol connection failure; define reconnect behavior and what visibility to use while disconnected. (first fail → always-visible; later drop → leave as-is + reconnect backoff)
- [x] Reapply click-through on every map. (Phase 1 `connect_map`; retained)
- [x] Keep GTK operations on the GTK main context (channel to main thread).
- [x] Unit tests for matching logic and focus transitions, including batched sequences.

Match policy (decided):

- Default **`contains`**: case-insensitive substring of `app_id`; title only when `app_id` is empty; needle default `osu` (C-compatible).
- **`exact`**: case-insensitive full-string equality (`--match-mode exact`) to avoid short-needle false positives.
- `regex` / separate `--match-title` deferred.

**Exit criteria:** focus changes are event-driven with no focus polling or redraw timers; HUD content updates continue independently; alt-tab sequences produce no spurious hide/show.

### Phase 5 — RAM and resource telemetry

Observation first; do not terminate the app based on memory measurements yet.

#### Metrics

1. **Overlay host:** RSS and, where available, PSS (`/proc/<pid>/smaps_rollup`).
2. **WebKit subprocesses:** each measured separately where practical.
3. **Process tree:** aggregate RSS and PSS reported separately (include the host itself).
4. **Cgroup memory:** if run as a user service/scope, record cgroup `memory.current` (and peak where available). This is more robust than walking the process tree, especially if WebKit sandboxing alters parentage.
5. **System context:** total/available memory to separate app growth from system pressure.
6. **Optional CPU:** to assess sampling overhead and workaround cost.

#### Sampling implementation

- [x] Configurable interval (start at 5 s for diagnostic runs). (`--telemetry-interval-sec`; 0 = off)
- [x] Never sample per frame.
- [x] Keep `/proc` reads off the GTK main loop. (`telemetry/` background thread)
- [x] Timestamped CSV or structured logs. (`--telemetry-csv` + tracing summary)
- [x] Record PID, process name, role, and process start time (guards against PID reuse).
- [x] Handle inaccessible or disappearing `/proc` entries gracefully.
- [x] Optional or low-overhead in normal use. (default off)
- [x] Sampler stops cleanly at shutdown.
- [x] Paint statistics (when `--debug`): count real frame-clock `paint` events, not a tick callback. The C counter is tick-based and probably reports roughly the refresh rate rather than actual repaints.

Suggested CSV columns:

```text
timestamp,phase,pid,start_time,process_name,role,rss_kib,pss_kib,cpu_percent
```

Add tree totals, cgroup values, and system memory as separate fields or a summary file.

#### Interpreting results

- Compare C and Rust under equivalent conditions, per phase (startup, steady state, gameplay, recovery).
- Look for stabilization versus continual growth over long sessions.
- Investigate repeatable upward trends, step increases after recovery, and memory that does not settle after WebKit restarts.
- Compare host-only and tree values to avoid blaming the Rust host for WebKit growth.
- Repeat tests; caches, GPU resources, shared memory, and system pressure add noise.

RSS/PSS samples show growth but cannot prove a leak. If growth repeats, use heap profiling or a native-memory profiler on the specific process. WebKit and GPU allocations may not appear as Rust heap allocations.

#### RAM acceptance criteria

- [ ] 60–120 minute soak shows no unexplained unbounded growth across repeated runs. (manual)
- [x] Host and WebKit memory documented separately. (roles in CSV / summary log)
- [ ] WebKit crashes/restarts do not accumulate orphan processes or steadily raise tree memory. (manual soak)
- [ ] Sampling overhead is negligible. (manual)
- [ ] Any automatic thresholds rest on measured behavior with a documented rationale. (Phase 6)

### Phase 6 — Watchdog and lifecycle recovery

- [x] Process-tree discovery and policy in separate modules; scans off the GTK main loop. (`watchdog/`)
- [x] Explicit, documented thresholds for runtime, FDs, and RSS/PSS (or cgroup memory). (`--watchdog-max-*`; optional `--watchdog-max-cgroup-mb`)
- [x] Log the measurements and exact reason for any action.
- [x] Reconsider the unconditional 30-minute exit; prefer measured policy. (`--watchdog-max-age-sec 0` disables; age still default 1800 for C parity)
- [x] Use a **non-zero exit code** for watchdog-triggered exits (or document the service restart policy) so `Restart=on-failure` works. (exit **75**)
- [x] Prefer a user-level service manager restart policy over a hard internal timeout. (documented; age optional)
- [x] Bounded WebKit retry/backoff (see Phase 3 state machine).
- [x] Distinguish a local HUD server outage from a WebKit process crash. (distinct log lines)
- [x] Define recovery when focus tracking disconnects. (Phase 4 reconnect / Unavailable)
- [x] Never terminate on a single noisy sample; require repeated samples over a window. (`--watchdog-breach-samples` default 3)

### Phase 7 — NixOS integration and reproducible builds

- [x] Add Rust builds to the existing project workflow. (`nix build .#roxysu-overlay-rs`, `bun run overlay:rs:release`)
- [x] Declare GTK4, WebKitGTK, layer-shell, Wayland protocol, and other native dependencies in the Nix environment. (`nix/overlay-rs.nix` + `devShell`)
- [x] Pin the Rust toolchain and dependency sources. (flake `nixpkgs` rustc/cargo + `Cargo.lock`)
- [x] Test development and optimized release builds. (devShell cargo + Nix release package; 43 tests in checkPhase)
- [x] Verify runtime library availability. (auto RPATH via rustPlatform / GTK store paths)
- [x] Update launch scripts and package metadata only after acceptance tests pass. (**not cut over** — C stays `overlayBin`; A/B via `ROXYSU_OVERLAY_BIN`)
- [x] Keep the tagged C binary available for rollback. (`nix build .#roxysu-overlay`, tag `c-baseline`)

### Phase 8 — Acceptance tests and cutover

Test C and Rust under equivalent conditions:

- [x] Default startup and CLI validation, including `=` inside values. (`overlay:rs:acceptance`)
- [ ] HUD loading and live gameplay updates at the required rate. (manual residual)
- [ ] HUD server unavailable at startup, then restored. (manual residual)
- [x] WebKit process termination and recovery, with no stacked reload timers. (unit + distinct logs; manual kill still recommended)
- [x] osu!lazer activation/focus changes and app-ID/title variations. (match/reducer unit tests; live manual residual)
- [x] Alt-tab sequences between windows with no spurious hide/show. (batched reducer unit test; live manual residual)
- [ ] osu!lazer close and restart. (manual residual)
- [ ] Multi-monitor and output selection. (manual residual)
- [ ] niri windowed and fullscreen gameplay. (manual residual)
- [ ] Renderer x DMA-BUF matrix. (manual residual)
- [x] Click-through before and after hide/show, no focus stealing. (map reapply; `--test-hide-show`)
- [x] No forced native redraw timer in the default configuration. (W1–W4 off by default)
- [ ] Long-session RAM/CPU telemetry. (manual residual; `--telemetry-*`)
- [ ] No unexplained memory growth, orphan WebKit processes, or unexplained exits. (manual residual)
- [x] Watchdog exit triggers a service restart. (exit **75**; desktop liveness respawn)
- [x] Clean shutdown and actionable logs.

**Cutover:** Rust is the only host (`overlayBin` → `nix/overlay-rs.nix`, provides `bin/roxysu-overlay`). C tree removed. Manual residuals tracked in [`findings/overlay-rs-phase8.md`](findings/overlay-rs-phase8.md).

## 7. Test strategy

1. **Unit tests:** CLI parsing/validation (including `=` in values), match policy, focus reducer and batching, reload/backoff state machine, resource-threshold decisions.
2. **Integration tests:** GTK/WebKit startup, HUD loading, live updates, memory sampling, controlled failure paths.
3. **Manual compositor tests:** niri focus behavior, fullscreen gameplay, transparency, click-through, monitor selection, extended sessions.

Compositor and GPU behavior needs manual testing. Keep the procedure short, repeatable, and identical for C and Rust.

## 8. Main risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing workarounds exposes a real WebKit/Wayland issue | Test W1–W5 separately; document the reproducible failure before restoring a targeted fix. |
| Hidden side effects (for example the unconditional tick callback) change behavior when removed | Inventory every mechanism; A/B each one. |
| Focus churn from per-event evaluation | Batch per dispatch; optional measured hysteresis. |
| Focus tracking confused with content rendering | Separate paths and threads; channel to the GTK thread. |
| Click-through lost after remap | Reapply on every map; test hide/show cycles. |
| Stacked reload timers | Single reload state machine with backoff. |
| Rust bindings lack a required API | Prove integrations early; isolate minimal FFI. |
| WebKit memory attributed to the host | Measure host, WebKit, tree, and cgroup separately. |
| RSS double-counts shared memory | Report PSS alongside RSS. |
| Watchdog baseline not comparable (excludes host, exits at 30 min) | Raise caps for soak runs; define Rust metrics explicitly. |
| Watchdog exit code 0 defeats service restart | Non-zero exit or documented restart policy. |
| NixOS native dependencies missing at runtime | Validate full build and runtime environment before cutover. |

## 9. Recommended work order

1. Tag the C baseline; fill in the behavior table and workaround inventory.
2. Run the C A/B render test with `--follow-focus 0`; capture baseline RAM/CPU with raised watchdog caps.
3. Prove GTK4 + WebKitGTK + layer-shell in Rust, including click-through after hide/show.
4. Prove foreign-toplevel focus events under niri on a dedicated connection.
5. Port CLI/configuration.
6. Port the overlay and live WebKit rendering without forced redraw hacks.
7. Port focus handling (reducer, batching, match policy) independently from HUD data updates.
8. Add RAM/CPU/cgroup telemetry and run C-versus-Rust soak tests.
9. Port recovery and watchdog policy.
10. Integrate the reproducible NixOS build.
11. Run acceptance tests, cut over, and keep rollback temporarily.

## 10. Definition of done

- HUD content remains responsive at the required update/rendering cadence.
- Focus tracking is event-driven, batched, and needs no periodic forced redraws.
- Any retained rendering workaround is justified by a reproducible issue and tested independently.
- GTK, WebKitGTK, layer-shell, and Wayland integrations work on the target setup; click-through survives hide/show.
- CLI parsing handles `=` inside values and validates input.
- RAM telemetry distinguishes host, WebKit processes, tree totals, and cgroup memory.
- Long soak tests show no unexplained unbounded memory growth across repeated runs.
- Failure recovery and shutdown are well-defined and logged; watchdog exits are restartable.
- The project builds reproducibly in the intended NixOS workflow.
- The tagged C binary remains available as rollback.

## 11. Scope and assumptions

This roadmap is based on a static review of the existing C implementation and the described Roxysu environment. Proposed crates and exact APIs must be verified against the target NixOS package versions. It is a migration and validation plan, not a claim that anything has been compiled or tested.
