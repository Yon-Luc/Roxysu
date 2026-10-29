# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash apps/overlay-rs/run.sh --follow-focus false
# or
bun run overlay:rs -- --follow-focus false
```

## CLI (Phase 2–3)

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
| `--debug` | off | also enables W4 paint-counter |
| `--gsk-renderer` | unset | `gl`/`ngl`/`cairo`/`vulkan` |
| `--webkit-no-dmabuf` | off | W7 |
| `--diag-damage-tick` | off | W1 opacity flip + queue_draw |
| `--diag-inject-keepalive` | off | W2 CSS keepalive |
| `--diag-reassert-placement` | off | W3 layer/anchor bounce on show |
| `--diag-paint-counter` | off | W4 tick callback (`--debug` implies) |
| `--diag-set-page-hidden` | off | W5 JS visibility toggle |
| `--watchdog-max-*` | C defaults | stored for Phase 6 |

Default path does **not** run W1–W5 — WebKit redraws on HUD content change. Use
`--diag-*` only when comparing compositor force-present behavior.

Reload policy (single pending slot): web-process crash → 1 s; load fail → 3 s,
then 15 s after more than five consecutive failures; reset on load finished.

SIGINT / SIGTERM quit via GApplication; the hold guard is dropped on shutdown.

```bash
cargo test   # in nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase3.md`](../../findings/overlay-rs-phase3.md) and the
migration plan Phase 3 section.
