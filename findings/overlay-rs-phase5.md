---
id: overlay-rs-phase5
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 5 — RAM and resource telemetry

Crate: [`apps/overlay-rs`](../apps/overlay-rs/)

Observation only — **no process termination** (that is Phase 6).

## Delivered

| Item | Where |
|---|---|
| Host + descendant RSS/PSS (`statm` / `smaps_rollup`) | `telemetry/procfs.rs`, `telemetry/tree.rs` |
| Roles: host / webkit-network / webkit-web / webkit-other / child | `ProcRole` |
| Tree totals + system MemTotal/MemAvailable | `telemetry/sample.rs` |
| Optional cgroup v2 `memory.current` / `memory.peak` | `telemetry/cgroup.rs` |
| Background sampler (default off) | `--telemetry-interval-sec`, `telemetry/sampling.rs` |
| CSV + tracing summary | `--telemetry-csv`, `--telemetry-phase` |
| Clean stop on GTK shutdown | `main.rs` drops `SamplerHandle` |
| Frame-clock paint stats under `--debug` | `diagnostics.rs` (`frame_paints/5s=…`) |
| Unit tests (parsers + roles + CLI) | 35 passing |

## Usage

```bash
bun run overlay:rs -- --telemetry-interval-sec=5 \
  --telemetry-csv=/tmp/overlay-rs-telem.csv \
  --telemetry-phase=steady
```

CSV columns match the plan (per-process rows plus tree/cgroup/system fields repeated).

## Still manual

- 60–120 min soak for unbounded growth
- Compare C vs Rust under equivalent load
- Confirm sampling overhead is negligible
