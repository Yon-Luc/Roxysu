# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash apps/overlay-rs/run.sh --follow-focus false
# or
bun run overlay:rs -- --follow-focus false
```

## CLI (Phases 2–5)

Same option names as the C host, plus diagnostic, focus, telemetry, and watchdog
knobs. Invalid values error out (no silent fallback).

| Flag | Default | Notes |
|---|---|---|
| `--url` | HUD with `bg=clear` | `--url=…` and `--url …`; `=` in values OK |
| `--anchor` | `top-right` | top/bottom × left/right |
| `--margin` | `0` | all four edges |
| `--width` / `--height` | `1920` / `1090` | must be > 0 |
| `--opacity` | `1.0` | `(0, 1]` |
| `--output` | compositor default | connector or model |
| `--follow-focus` | `true` | `true`/`false` |
| `--match-app-id` | `osu` | needle for match policy |
| `--match-mode` | `contains` | `contains` \| `exact` |
| `--hide-hysteresis-ms` | `80` | delay before Hide; cancelled by Show |
| `--list-windows` | off | dump foreign-toplevels |
| `--debug` | off | W4 tick diag + real frame-clock paint stats |
| `--gsk-renderer` | unset | `gl`/`ngl`/`cairo`/`vulkan` |
| `--webkit-no-dmabuf` | off | W7 |
| `--diag-*` | off | W1–W5 compositor force-present hacks |
| `--telemetry-interval-sec` | `0` | 0 = off; try `5` for diagnostic soaks |
| `--telemetry-csv` | unset | append CSV rows (created if missing) |
| `--telemetry-phase` | `steady` | label column for the run |
| `--watchdog-max-*` | C defaults | stored for Phase 6 |

Telemetry is observation-only (no kills). Samples run on a background thread.

```bash
bun run overlay:rs -- --telemetry-interval-sec=5 \
  --telemetry-csv=/tmp/overlay-rs-telem.csv
```

```bash
cargo test   # in nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase5.md`](../../findings/overlay-rs-phase5.md).
