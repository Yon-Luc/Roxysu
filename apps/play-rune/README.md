# Roxysu Play — Rune shell

Isolated Rune frontend evaluating GPUIX → Rune. **Does not replace** `apps/play`.

Pinned Rune: [`docs/rune-migration/rune-pin.md`](../../docs/rune-migration/rune-pin.md).

## Features

| Area | Status |
|---|---|
| Library | Read-only **local mirror** mania 7K list (first 200 by title) |
| Start | Loads `.osu` from lazer `files/` via beatmap `hash` |
| Play | CPU playfield → `Pixels`/`NativeSurface` + rodio audio (`S D F Space J K L`, Esc) |
| Scroll | osu!mania-style px/s (default 400); `[` `]` in play / library ± buttons |
| Skin | Optional PNG blit from lazer `skins/` (`I` A/B vs procedural; `ROXYSU_PLAY_SKIN`) |
| Perf HUD | fps · raster_ms · set_ms · sink (`P`) — compare skin on/off here |
| Resources | rss / cpu% / gpu · audio status |
| Overlay | Click-through / show-hide prototype |
| GPUIX Play | Unchanged fallback |

Paths (override with env):

- Mirror: `DB_PATH` or `ROXYSU_DATA_DIR/data.sqlite` or monorepo `apps/server/data.sqlite`
- Lazer: `OSU_DATA_PATH` or `~/.local/share/osu`

## Run

```bash
# Feel / FPS baseline (optimized)
bun run play:rune:release

# Fast iterate (debug — not a performance baseline)
bun run play:rune
bun run play:rune:smoke
nix develop -c bash -lc 'cd apps/play-rune && cargo test'
```

During play, read the mono perf line. Press `P` to toggle `Pixels` ↔ `NativeSurface` on the same chart/clock.
