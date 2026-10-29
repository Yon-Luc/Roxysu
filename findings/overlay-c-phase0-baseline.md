---
id: overlay-c-phase0-baseline
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 0 — C `roxysu-overlay` baseline

Frozen rollback for the Rust migration ([`roxysu-overlay-rust-migration-plan-v3.md`](../roxysu-overlay-rust-migration-plan-v3.md)).
**C source was not modified.**

## Freeze

| Item | Value |
|---|---|
| Git tag | `c-baseline` (annotated) |
| Commit | `e393b360a76c23adeb1dd2863cd5c855474bab32` |
| Binary archive | `apps/overlay/baselines/roxysu-overlay.c-baseline` (gitignored) |
| SHA256 | `0a25c1b64cc1c3bde653619ed66464e166b2d15e77e672d927d9adf046d285bb` |
| Rebuild (dev) | `nix develop --command ./apps/overlay/build.sh` |
| Rebuild (Nix) | `nix build .#roxysu-overlay` |

## CLI inventory (defaults)

From `apps/overlay/main.c` at `c-baseline`:

| Flag | Default | Notes |
|---|---|---|
| `--url` | `http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic` | Values with `=` must be one `--url=…` token (arg expander) |
| `--anchor` | `top-right` | `top-left` / `top-right` / `bottom-left` / `bottom-right` |
| `--margin` | `0` | Applied to all four edges; raw `atoi` |
| `--width` / `--height` | `1920` / `1090` | Invalid → silent fallback to default |
| `--opacity` | `1.0` | Invalid → silent fallback to `1.0` |
| `--output` | `NULL` (compositor default) | Help text incorrectly says "cursor output" |
| `--match-app-id` | `osu` | Case-insensitive substring |
| `--follow-focus` | `1` | `0` = always visible; disables W1–W3 path |
| `--gsk-renderer` | unset | Sets `GSK_RENDERER` |
| `--webkit-no-dmabuf` | off | Sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` |
| `--debug` | off | Paint tick stats every 5 s |
| `--list-windows` | off | Dump foreign-toplevels and exit |

Click-through: always (empty input region on every `map`). Layer: `OVERLAY`, `exclusive_zone = -1`, keyboard `NONE`, namespace `roxysu-overlay`.

Extra C quirk (not fixed): `--list-windows` path returns `ft_print_windows()` which always returns `0`, so the host prints `compositor lacks zwlr_foreign_toplevel_management` even after listing windows successfully.

## Build and launch

| Path | How |
|---|---|
| Dev build | `nix develop` → `./apps/overlay/build.sh` → `./apps/overlay/roxysu-overlay` |
| Nix package | [`nix/overlay.nix`](../nix/overlay.nix) → `nix build .#roxysu-overlay` |
| Desktop bundle | Flake copies binary to `resources/overlay/roxysu-overlay`; Electron `spawnOverlayHost` in `apps/desktop/main.js` |
| Override | `ROXYSU_OVERLAY_BIN` or local `apps/overlay/roxysu-overlay` |
| Settings | `overlay.host_url`, `overlay.host_enabled` via `GET /api/settings` poll (~4 s) |
| Dev launch tip | Prefer `--output=DP-4` on this machine (ZOWIE); see `package.json` `"overlay"` script |

Soak env overrides (raise before long RAM runs so the host does not exit at 1800 s):

```bash
export ROXYSU_WATCHDOG_MAX_AGE_SEC=7200
# optional: ROXYSU_WATCHDOG_MAX_FDS ROXYSU_WATCHDOG_MAX_RSS_MB
```

Note: C watchdog tree RSS **excludes the host PID** (descendants only) and exits **0** on breach.

## Process map

Captured 2026-10-29 during Phase 0 RAM run (`--follow-focus 0`, HUD URL, `--output=DP-4`).

| Role | PID (example) | Notes |
|---|---|---|
| Host (`roxysu-overlay`) | 317713 | GTK/WebKit host |
| WebKitNetworkProcess | 317814 | child |
| WebKitWebProcess | 317822 | child (largest RSS) |
| bwrap / xdg-dbus-proxy | several | WebKit sandbox helpers |

C watchdog “tree” totals mark descendants of the host only — **host RSS is not included**.

```text
pgrep -a roxysu-overlay
# sample helper: apps/overlay/baselines/sample-mem.sh <phase>
```

## C A/B render matrix (§6b)

Fixed flags: `--follow-focus 0` (W1–W3 off). HUD URL
`http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic`, `--output=DP-4`, niri 26.04.

**Observation method:** `niri msg layers` (namespace `roxysu-overlay` on Overlay), process liveness, stderr for load/crash. `grim` does **not** capture layer-shell pixels reliably — do not use grim alone. Human confirmed a solid red HTTP probe (`ROXYSU OVERLAY PROBE`) drawn above osu!lazer — evidence: `apps/overlay/baselines/ab/user-confirmed-probe.jpg`.

| Scenario | Renderer / DMA-BUF | Result | Notes |
|---|---|---|---|
| windowed | default | pass | layer=1, alive, no load-fail/crash |
| windowed | `--gsk-renderer ngl` | pass | GSK warns `ngl` renamed to `gl` |
| windowed | `--gsk-renderer gl` | pass | |
| windowed | `--gsk-renderer cairo` | pass | |
| windowed | `--gsk-renderer vulkan` | pass | |
| windowed | `--webkit-no-dmabuf` | pass | |
| fullscreen | default | pass | osu 1920×1080 fullscreen; layer above |
| fullscreen | `--gsk-renderer ngl` | pass | |
| fullscreen | `--gsk-renderer gl` | pass | |
| fullscreen | `--gsk-renderer cairo` | pass | |
| fullscreen | `--gsk-renderer vulkan` | pass | |
| fullscreen | `--webkit-no-dmabuf` | pass | |

Logs also show `MESA-EGL: failed to create dri2 screen` and occasional `Fontconfig error` under `nix develop`; content still visible to the user. NVIDIA open kernel module **595.104.02** present; `nvidia-smi` segfaulted in this session (environment noise, not overlay logic).

### Follow-focus follow-up (optional)

No failing fullscreen cell — follow-up with `--follow-focus 1` not required for A/B. Focus-churn RAM stage still uses `--follow-focus 1` separately.

| Cell | `--follow-focus 1` result | Notes |
|---|---|---|
| _(none failing)_ | n/a | |

### Workaround verdict (after matrix)

| ID | Verdict | Rationale |
|---|---|---|
| W1 | **removal candidate** (default off in Rust) | Not installed with `--follow-focus 0`; probe + HUD layer still visible windowed and fullscreen on niri |
| W2 | **removal candidate** (default off in Rust) | Same — only injected on show via `apply_visibility` |
| W3 | **keep for remap path / validate with focus** | Not exercised when always-visible; still needed hypothesis for hide→show above fullscreen (F-039) |
| W4 | **removal candidate** unless `--debug` | Tick callback always installed; A/B did not depend on it for visibility |
| W5 | **evaluate with focus hide/show** | Only on follow-focus hide/show; prefer native unmap first in Rust |
| W6 | **keep** | F-039 remap; still required on show path when follow-focus hides |
| W7 | **keep as config** | All matrix cells passed; retain knobs for crash/glitch A/B |

**Implication for Rust:** default path can omit W1/W2/W4. Prove live gameplay frame updates and focus remap (W3/W5/W6) in Phase 3–4 before deleting those mechanisms entirely.

## RAM / CPU baseline samples

CSV (appended live): [`apps/overlay/baselines/ram-samples.csv`](../apps/overlay/baselines/ram-samples.csv)  
Helper: [`apps/overlay/baselines/sample-mem.sh`](../apps/overlay/baselines/sample-mem.sh)

Prefer PSS alongside RSS. Tree = host + descendants (unlike C watchdog).

### Stage checklist

| Stage | Status | Notes |
|---|---|---|
| 1. Startup + HUD loaded | done | first sample host 247664 / 129284 PSS |
| 2. ~5 min idle | done | host stable ~266300 / 137769 from 1m→5m |
| 3. 20–30 min gameplay | abbreviated | song-select + HUD open; not a full play session |
| 4. Focus changes (`--follow-focus 1`) | done | hide/show logs confirmed; host ~288100 / 149499 |
| 5. Longer soak (optional) | skipped | |
| 6. HUD server down/up | done | killed :4321, respawned; overlay stayed up; host ~284128 after restore |
| 7. WebKit kill/recovery | skipped | |

### Summary totals

Host-only and tree (= host + descendants; **not** comparable to C watchdog tree which excludes host).

| Phase | Host RSS/PSS KiB | Tree RSS/PSS KiB | Notes |
|---|---|---|---|
| startup (first) | 247664 / 129284 | ~540k / ~306k | WebKitWeb ~208k RSS |
| idle 1m | 266288 / 137757 | 651908 / 364733 | |
| idle 3m | 266296 / 137765 | 657628 / 370453 | flat |
| idle 5m | 266300 / 137769 | 652764 / 365589 | flat — no growth |
| focus-churn | 288100 / 149499 | 688308 / 387093 | new process with `--follow-focus 1` |
| server-up | 284128 / 147523 | 666016 / 366765 | after :4321 kill+restart |
| gameplay-abbrev | 288216 / 147555 | 671748 / 368441 | not a full play session |

Focus path logs showed repeated `shown`/`hidden` and `--debug` paints/5s in the hundreds while mapped (tick-callback inflated; not true frame paints).

## Environment (runtime capture)

| Item | Value |
|---|---|
| Date | 2026-10-29 |
| Compositor | niri 26.04 (Nixpkgs) |
| Outputs | DP-4 ZOWIE 1920×1080@144 (osu); DP-5 Lenovo portrait |
| GPU / driver | NVIDIA 10de:2f04; NVRM Open Kernel Module 595.104.02 |
| GTK / WebKit (nix develop) | gtk4 4.22.4; webkitgtk-6.0 2.54.1; gtk4-layer-shell 1.3.0 |
