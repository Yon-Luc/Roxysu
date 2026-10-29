# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the **shipped default** (desktop toggle + Nix package).

## Build / run

```bash
# Dev (debug)
bun run overlay:rs -- --follow-focus false

# Release via cargo
bun run overlay:rs:release

# Nix package (release + tests)
nix build .#roxysu-overlay-rs
./result/bin/roxysu-overlay-rs --help
```

## Desktop toggle?

**Not wired by default.** Settings → In-game overlay enable still spawns
`roxysu-overlay` (C). To try Rust through the same toggle:

```bash
export ROXYSU_OVERLAY_BIN="$(nix build --print-out-paths .#roxysu-overlay-rs)/bin/roxysu-overlay-rs"
# launch Roxysu desktop
```

## CLI

See migration plan Phases 2–6. Highlights: `--match-mode`, `--telemetry-*`,
`--watchdog*` (exit 75), `--diag-*`.

```bash
cargo test   # nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase7.md`](../../findings/overlay-rs-phase7.md).
