# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). **Phase 8
default** for Roxysu desktop packaging (`resources/overlay/roxysu-overlay`).

## Build / run

```bash
bun run overlay                 # Rust (default)
bun run overlay:c               # C rollback binary if built
bun run overlay:rs:acceptance   # automated Phase 8 gate
nix build .#roxysu-overlay      # ships bin/roxysu-overlay → roxysu-overlay-rs
nix build .#roxysu-overlay-c    # C rollback package
```

## Desktop toggle

Settings → In-game overlay enable starts the Rust host when packaged or when
`apps/overlay-rs/target/*/roxysu-overlay-rs` exists. Override anytime:

```bash
ROXYSU_OVERLAY_BIN=$(nix build --print-out-paths .#roxysu-overlay-c)/bin/roxysu-overlay
```

## CLI

Phases 2–6 flags: `--match-mode`, `--telemetry-*`, `--watchdog*` (exit 75),
`--diag-*`. See [`findings/overlay-rs-phase8.md`](../../findings/overlay-rs-phase8.md).
