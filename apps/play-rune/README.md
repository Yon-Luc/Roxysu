# Roxysu Play — Rune prototype

Isolated feasibility probe for replacing GPUIX presentation with
[Rune](https://github.com/anomalyco/rune). Does **not** replace `apps/play`.

Pinned Rune revision: see [`docs/rune-migration/rune-pin.md`](../../docs/rune-migration/rune-pin.md).

## Run

```bash
nix develop -c bun run play:rune
# or
nix develop -c bash apps/play-rune/run.sh
```

Headless smoke (when the display server is unavailable):

```bash
nix develop -c bash apps/play-rune/run.sh -- --snap /tmp/play-rune.png
```

## What it does

1. Control window — show/hide overlay, toggle click-through.
2. Per-display `WindowOptions::overlay` surface — transparent, borderless, topmost.
3. Fake telemetry thread (~10 Hz) writing a coalesced `LiveText` status (latest-wins).
