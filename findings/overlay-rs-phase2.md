---
id: overlay-rs-phase2
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 2 — CLI and configuration

Crate: [`apps/overlay-rs`](../apps/overlay-rs/)

## Delivered

| Item | Where |
|---|---|
| Clap surface (C option names/defaults) | `src/cli.rs` |
| Typed `Config` + validation | `src/config.rs` |
| `--url` with `=` in values | clap + unit tests |
| `--gsk-renderer` / `--webkit-no-dmabuf` | CLI → `Config::apply_process_env` |
| W1–W5 `--diag-*` (default off) | flags stored; warn until Phase 3 wires behavior |
| Honest `--output` help | compositor default when omitted |
| Watchdog threshold fields | stored for Phase 6 |
| Unit tests | 13 passing (`cargo test`) |

## Not in this phase

- Implementing W1–W5 runtime behavior (Phase 3)
- Reload state machine (Phase 3)
- Watchdog enforcement (Phase 6)
