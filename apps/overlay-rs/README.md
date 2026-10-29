# roxysu-overlay-rs

Rust Wayland overlay host (GTK4 + WebKitGTK 6 + gtk4-layer-shell). The C host in
`apps/overlay/` remains the shipped default until later migration phases.

## Build / run

```bash
nix develop --command bash apps/overlay-rs/run.sh --follow-focus false
# or
bun run overlay:rs -- --follow-focus false
```

## CLI (Phases 2–4)

Same option names as the C host, plus diagnostic, focus, and watchdog knobs.
Invalid values error out (no silent fallback). Help documents the real
`--output` default: compositor choice when omitted.

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
| `--match-mode` | `contains` | `contains` \| `exact` (title only if app_id empty) |
| `--hide-hysteresis-ms` | `80` | delay before Hide; cancelled by Show |
| `--list-windows` | off | dump foreign-toplevels |
| `--debug` | off | also enables W4 paint-counter |
| `--gsk-renderer` | unset | `gl`/`ngl`/`cairo`/`vulkan` |
| `--webkit-no-dmabuf` | off | W7 |
| `--diag-*` | off | W1–W5 compositor force-present hacks |
| `--watchdog-max-*` | C defaults | stored for Phase 6 |

Default path does **not** run W1–W5 — WebKit redraws on HUD content change.

Focus: dedicated Wayland connection; pure reducer flushed once per dispatch
batch; GTK show/hide only on the main context. First foreign-toplevel failure
falls back to always-visible; later disconnects leave visibility unchanged and
reconnect with backoff.

Reload policy (single pending slot): web-process crash → 1 s; load fail → 3 s,
then 15 s after more than five consecutive failures; reset on load finished.

```bash
cargo test   # in nix develop, under apps/overlay-rs
```

See [`findings/overlay-rs-phase4.md`](../../findings/overlay-rs-phase4.md).
