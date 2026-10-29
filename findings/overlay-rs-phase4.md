---
id: overlay-rs-phase4
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 4 — Event-driven Wayland focus tracking

Crate: [`apps/overlay-rs`](../apps/overlay-rs/)

## Delivered

| Item | Where |
|---|---|
| Match policy (`contains` / `exact`) | `focus/matching.rs`, `--match-mode` |
| Pure Show/Hide reducer | `focus/reducer.rs` |
| One visibility eval per Wayland dispatch batch | `focus/wayland.rs` → `end_batch()` |
| Hide hysteresis (default 80 ms, cancellable) | `--hide-hysteresis-ms`; GTK main context |
| First-connect failure → always-visible | `FocusCommand::Unavailable` |
| Mid-run drop → leave visibility + reconnect | `FocusCommand::Disconnected` + backoff |
| Click-through on every `map` | `overlay.rs` `connect_map` (unchanged) |
| Unit tests | 28 passing |

## Match policy

- **contains** (default): CI substring on `app_id`; `title` only if `app_id` empty. Needle default `osu`.
- **exact**: CI equality; use when short needles false-positive (e.g. `bosun`).

## Disconnect policy

| Situation | Visibility | Next step |
|---|---|---|
| Protocol / display missing on first connect | Always show | Log + stop retrying that session |
| Session ends or errors later | Unchanged | Reconnect with exponential backoff (1→30 s) |

## Manual check

Alt-tab between osu!lazer and another window: overlay should not flicker hide/show mid-transition.
