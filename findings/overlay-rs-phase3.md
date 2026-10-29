---
id: overlay-rs-phase3
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 3 — Native overlay and live WebKit rendering

Crate: [`apps/overlay-rs`](../apps/overlay-rs/)

## Delivered

| Item | Where |
|---|---|
| Single-slot reload / backoff machine | `src/reload.rs` (1 s web-process; 3 s / 15 s after >5 load fails) |
| `load-changed` / `load-failed` / `web-process-terminated` | `overlay.rs:wire_reload` |
| W1–W5 behind `--diag-*` (default off) | `src/diagnostics.rs` |
| `--debug` implies W4 paint counter | `cli.rs` → `DiagnosticFlags.paint_counter` |
| Clean shutdown | `main.rs` drops hold on `Application::shutdown` |
| Unit tests | 17 passing (`cargo test`) |

## Design notes

- **Default path trusts WebKit redraw.** W1–W4 are compositor force-present hacks and stay off unless `--diag-*` / `--debug`.
- W5 (`set_page_hidden`) is also diagnostic-only; native map/unmap remains the visibility authority.
- W6 (set_visible + present) and W7 (GSK / DMA-BUF env) remain on the normal path as before.
- Reload: at most one pending timer; concurrent triggers while pending are ignored (`AlreadyPending`).

## Still manual (exit criteria)

- Live HUD responsiveness under rapid gameplay updates (with W1–W4 off).
- Per-workaround A/B under niri fullscreen osu!lazer × GSK renderer × DMA-BUF.

## Not in this phase

- Batched focus reducer (Phase 4)
- RAM telemetry / watchdog (Phases 5–6)
