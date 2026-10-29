---
id: overlay-rs-phase1
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 1 — Rust overlay prototype

Branch: `overlay-rust-phase1`  
Crate: [`apps/overlay-rs`](../apps/overlay-rs/)  
Binary: `roxysu-overlay-rs`

## Exit criteria

| Criterion | Status | Evidence |
|---|---|---|
| Renders live HUD (WebKit + layer-shell) | pass | Layer namespace `roxysu-overlay` on Overlay; loads `#/overlay?bg=clear` |
| Transparent window | pass | CSS + `WebView::set_background_color` alpha 0 |
| Click-through after hide/show | pass | `--test-hide-show`: `GdkInputRegion` reapplied on remap (`still_mapped=true`) |
| Layer / anchors / size / monitor | pass | `Layer::Overlay`, top-right anchors, `--width`/`--height`, `--output=DP-4` |
| Foreign-toplevel on dedicated connection | pass | `--list-windows` lists `osu!`; follow-focus logs `focus: show` / `focus: hide` |
| GDK input-region vs raw wl_compositor | **GDK works** | No raw `wl_compositor` binding needed for click-through |
| NixOS reproducible build | pass | `nix develop` + `cargo build` (rustc/cargo/clang added to flake) |

## Run

```bash
nix develop --command bash -lc '
  export LIBCLANG_PATH=$(dirname $(readlink -f $(command -v clang))/../lib) # or clang-lib path
  cd apps/overlay-rs && cargo build
  ./target/debug/roxysu-overlay-rs --follow-focus false --output=DP-4 \
    --url="http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic"
'
# or: bun run overlay:rs
```

Useful flags: `--list-windows`, `--test-hide-show`, `--follow-focus true|false`, `--match-app-id osu`.

## Stack (verified)

| Concern | Crate / native |
|---|---|
| GTK4 | `gtk4` 0.11 (`v4_14`) + gtk4 4.22.4 |
| WebKit | `webkit6` 0.6.1 + webkitgtk 2.54.1 |
| Layer-shell | `gtk4-layer-shell` 0.8.1 + native 1.3.0 |
| Wayland focus | `wayland-client` 0.31 + `wayland-protocols-wlr` 0.3 (`foreign_toplevel`) |
| CLI | `clap` 4 (argv **not** forwarded to GtkApplication) |

## Gaps / notes for later phases

1. **Fontconfig** under `nix develop` still prints `Cannot load default config file` — add `fontconfig` + fonts to the shell or document `FONTCONFIG_FILE` (HUD still loads; text may fall back).
2. **MESA-EGL dri2 warnings** on NVIDIA — same as C host; content still visible.
3. **No W1–W7**, no watchdog, no telemetry — by design for Phase 1.
4. **`event_created_child!`** required for foreign-toplevel manager (wayland-client 0.31).
5. Desktop / Nix package still ships the **C** binary; cutover is Phase 7–8.
6. Full module layout from the migration plan is only partially present (`main`, `overlay`, `click_through`, `focus`); expand in Phase 2+.

## Related

- [overlay-c-phase0-baseline.md](overlay-c-phase0-baseline.md)
- [roxysu-overlay-rust-migration-plan-v3.md](../roxysu-overlay-rust-migration-plan-v3.md) § Phase 1
