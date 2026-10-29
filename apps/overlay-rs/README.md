# roxysu-overlay-rs (Phase 1 prototype)

Rust proof of GTK4 + WebKitGTK 6 + gtk4-layer-shell + GDK click-through + dedicated
`zwlr_foreign_toplevel` focus tracking. The C host in `apps/overlay/` remains the
shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash -lc 'cd apps/overlay-rs && cargo build'
./apps/overlay-rs/target/debug/roxysu-overlay-rs --output=DP-4 \
  --url='http://127.0.0.1:4321/#/overlay?bg=clear&limit=25&profile=Classic'
```

Or `bun run overlay:rs -- --follow-focus false` (args after `--` reach the binary via `run.sh`).

## Phase 1 flags

| Flag | Purpose |
|---|---|
| `--url` | HUD URL (`=` inside values OK) |
| `--output` | Monitor connector/model |
| `--follow-focus` | `true`/`false` (clap `ArgAction::Set`) |
| `--match-app-id` | Substring match (default `osu`) |
| `--list-windows` | Dump foreign-toplevels and quit |
| `--test-hide-show` | Hide then show once; verify click-through remap |

See [`findings/overlay-rs-phase1.md`](../../findings/overlay-rs-phase1.md).
