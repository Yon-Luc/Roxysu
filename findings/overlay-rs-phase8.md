---
id: overlay-rs-phase8
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 8 — Acceptance and cutover

## Cutover (done)

| Before | After |
|---|---|
| Packaged `overlayBin` = C (`nix/overlay.nix`) | Packaged `overlayBin` = Rust (`nix/overlay-rs.nix`) |
| `resources/overlay/roxysu-overlay` → C | → Rust (`roxysu-overlay` symlink to `roxysu-overlay-rs`) |
| Dev resolve: C binary only | Prefers Rust `target/{release,debug}`, then C rollback |
| `bun run overlay` | Rust host (`overlay:c` keeps C) |

**Rollback**

```bash
# One-shot
ROXYSU_OVERLAY_BIN=$(nix build --print-out-paths .#roxysu-overlay-c)/bin/roxysu-overlay

# Or rebuild packages with overlayBin = overlayCBin in flake.nix
nix build .#roxysu-overlay-c
```

## Automated gate (PASS)

```bash
bun run overlay:rs:acceptance
# cargo test (43) + CLI smoke including URL with `=`
```

Covered checklist items:

- Default CLI validation including `=` in values
- No forced redraw timer in default config (W1–W4 off; unit/config coverage)
- Watchdog non-zero exit (75) for restart policies
- Clean shutdown path (hold drop on GTK shutdown)
- Distinct HUD load-fail vs web-process crash logs
- Reload single-slot / backoff unit tests
- Focus batching / match policy unit tests
- Nix package builds + ships `roxysu-overlay` name

## Manual residual (repeat under niri; not blocking cutover)

Track in soak notes; re-open if a scenario fails:

- [ ] Live HUD updates during gameplay at expected cadence
- [ ] HUD server down at start, then restored → reload recovers
- [ ] Kill WebKit web process → single reload, no timer stack
- [ ] Focus / app-id / title variations; alt-tab without flicker
- [ ] osu!lazer close + restart
- [ ] Multi-monitor `--output`
- [ ] Windowed + fullscreen
- [ ] Renderer × DMA-BUF matrix if regressions appear
- [ ] Click-through after hide/show; no focus steal
- [ ] Long-session telemetry; no orphan WebKit / unexplained growth
- [ ] Watchdog breach → desktop respawn within poll window
