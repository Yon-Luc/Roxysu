# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). This is the
only overlay host — packaged as `resources/overlay/roxysu-overlay`.

## Build / run

```bash
bun run overlay                 # debug run
bun run overlay:build           # release cargo build
bun run overlay:rs:acceptance   # unit + CLI smoke
nix build .#roxysu-overlay      # Nix package (bin/roxysu-overlay → roxysu-overlay-rs)
```

## Desktop toggle

Settings → In-game overlay enable spawns this binary (packaged or
`apps/overlay-rs/target/*/roxysu-overlay-rs`). Override with `ROXYSU_OVERLAY_BIN`.

## CLI

`--match-mode`, `--telemetry-*`, `--watchdog*` (exit 75), `--diag-*` (W1–W5 off
by default). See `findings/overlay-rs-phase8.md`.
