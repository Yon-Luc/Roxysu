# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash apps/overlay-rs/run.sh --follow-focus false
# or
bun run overlay:rs -- --follow-focus false
```

## CLI (Phases 2–6)

| Flag | Default | Notes |
|---|---|---|
| `--url` | HUD with `bg=clear` | `=` inside values OK |
| `--follow-focus` | `true` | |
| `--match-app-id` / `--match-mode` | `osu` / `contains` | `exact` available |
| `--hide-hysteresis-ms` | `80` | |
| `--telemetry-interval-sec` | `0` | observation only |
| `--telemetry-csv` | unset | |
| `--watchdog` | `true` | `--watchdog=false` for long soaks |
| `--watchdog-interval-sec` | `20` | |
| `--watchdog-max-age-sec` | `1800` | `0` = disable age cap |
| `--watchdog-max-fds` | `450` | descendants |
| `--watchdog-max-rss-mb` | `4200` | descendant RSS only |
| `--watchdog-max-cgroup-mb` | unset | optional |
| `--watchdog-breach-samples` | `3` | consecutive breaches before exit |
| `--diag-*` / `--debug` | off | W1–W5; debug also frame-clock paints |
| `--gsk-renderer` / `--webkit-no-dmabuf` | unset / off | W7 |

Watchdog exits with code **75** (not 0) so `Restart=on-failure` works.

```bash
cargo test   # nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase6.md`](../../findings/overlay-rs-phase6.md).
