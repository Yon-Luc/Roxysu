---
id: overlay-rs-phase7
feature: in-game-overlay
kind: baseline
severity: info
confidence: verified
status: done
---

# Phase 7 — NixOS integration

## Delivered

| Item | Where |
|---|---|
| Nix package | `nix/overlay-rs.nix` → `nix build .#roxysu-overlay-rs` |
| Flake export | `packages.roxysu-overlay-rs` (C remains `roxysu-overlay`) |
| Dev shell deps | already GTK4 / WebKit / layer-shell / rustc / cargo |
| Release script | `bun run overlay:rs:release` |
| Desktop **not** cut over | still bundles/spawns C `roxysu-overlay` |

## Toggle / Roxysu connection

**Not default.** Settings toggle `overlay.host_enabled` starts the **C** host
(`resources/overlay/roxysu-overlay` or `apps/overlay/roxysu-overlay`).

To A/B the Rust binary through the same toggle:

```bash
export ROXYSU_OVERLAY_BIN="$(nix build --print-out-paths .#roxysu-overlay-rs)/bin/roxysu-overlay-rs"
# then launch desktop as usual
```

Or a local debug build:

```bash
export ROXYSU_OVERLAY_BIN="$PWD/apps/overlay-rs/target/debug/roxysu-overlay-rs"
```

Phase 8 acceptance must pass before swapping `overlayBin` in the packaged app.

## Verified

- `nix build .#roxysu-overlay-rs` succeeds; binary runs `--help`.
- Package checkPhase ran the crate unit tests (43 passed).
