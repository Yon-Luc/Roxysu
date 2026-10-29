---
id: overlay-rs-phase6
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 6 — Watchdog and lifecycle recovery

Crate: [`apps/overlay-rs`](../apps/overlay-rs/)

## Delivered

| Item | Where |
|---|---|
| Pure threshold policy + consecutive window | `watchdog/policy.rs` |
| `/proc` scan (descendant RSS/FDs; optional cgroup) | `watchdog/scan.rs` |
| Background runner, exit **75** | `watchdog/runner.rs` |
| CLI | `--watchdog`, `--watchdog-interval-sec`, `--watchdog-max-*`, `--watchdog-breach-samples` |
| Age optional | `--watchdog-max-age-sec 0` disables (prefer systemd/desktop Restart) |
| HUD load-fail vs web-process crash | distinct warn lines in `overlay.rs` |
| Focus disconnect recovery | Phase 4 (`Disconnected` / `Unavailable` + reconnect) |
| Unit tests | policy window + CLI; suite green |

## Policy notes

- **RSS cap** applies to **descendants only** (C-compatible; host excluded). Logs also print full `tree_rss_mb`.
- **Breach window:** default 3 consecutive samples of the *same* reason before exit.
- **Exit code 75** (not C’s `exit(0)`) so `Restart=on-failure` works.
- Prefer disabling age (`0`) and letting a user service restart on crash/watchdog rather than relying on the 30‑minute timer for normal longevity.

## Long soak tip

```bash
bun run overlay:rs -- --watchdog=false --telemetry-interval-sec=5 \
  --telemetry-csv=/tmp/overlay-rs-telem.csv
```
