# Rune pin

**Repository:** https://github.com/anomalyco/rune  
**Branch tip recorded:** `dev`  
**Pinned revision:** `a57ffe07a05bdd1920908e6f97db91ceadea5bcc`  
**Recorded:** 2026-11-06  

Rune is pre-release. Consumers pin a `dev` rev; do not float on a branch name in `Cargo.toml`.

```toml
rune = { git = "https://github.com/anomalyco/rune", rev = "a57ffe07a05bdd1920908e6f97db91ceadea5bcc" }
```

## APIs used by `apps/play-rune`

| API | Purpose |
|---|---|
| `rune::run_windows` | Multi-window host (control + overlays) |
| `rune::AppSpec` | Per-window title, size, `init`, `view`, optional `setup` / `poll` |
| `rune::WindowSpec` | Stable window key + state + options |
| `rune::WindowOptions::overlay(display)` | Transparent, borderless, topmost, click-through presentation sized to a display |
| `WindowHandle::set_click_through` | Runtime click-through toggle |
| `WindowHandle::show` / `hide` / `close` | Overlay visibility (as available on the pinned rev) |
| `rune::Live` | Cross-window coalesced value for fake telemetry counter |
| Headless flags (`--snap`, `--tree`, …) | Smoke without a display when supported |

Reference examples upstream: `examples/hello`, `examples/overlay`.

## Upgrade policy

Bump the pin intentionally, re-run Niri smoke checks, and update this file + `platform-matrix.md` in the same change.
