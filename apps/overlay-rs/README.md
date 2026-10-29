# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash apps/overlay-rs/run.sh --follow-focus false
# or
bun run overlay:rs -- --follow-focus false
```

## CLI (Phase 2)

Same option names as the C host, plus diagnostic and watchdog knobs. Invalid
values error out (no silent fallback). Help documents the real `--output`
default: compositor choice when omitted.

| Flag | Default | Notes |
|---|---|---|
| `--url` | HUD with `bg=clear` | `--url=…` and `--url …`; `=` in values OK |
| `--anchor` | `top-right` | top/bottom × left/right |
| `--margin` | `0` | all four edges |
| `--width` / `--height` | `1920` / `1090` | must be > 0 |
| `--opacity` | `1.0` | `(0, 1]` |
| `--output` | compositor default | connector or model |
| `--follow-focus` | `true` | `true`/`false` |
| `--match-app-id` | `osu` | case-insensitive substring |
| `--list-windows` | off | dump foreign-toplevels |
| `--debug` | off | also enables W4 paint-counter diag flag |
| `--gsk-renderer` | unset | `gl`/`ngl`/`cairo`/`vulkan` |
| `--webkit-no-dmabuf` | off | W7 |
| `--diag-*` | off | W1–W5 (behavior in Phase 3+) |
| `--watchdog-max-*` | C defaults | stored for Phase 6 |

```bash
cargo test   # in nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase1.md`](../../findings/overlay-rs-phase1.md) and the
migration plan Phase 2 section.
