# Roxysu Game Architecture Plan

Start with **00-main-plan.md**.

Detailed subsystem plans:

1. `01-game-core.md`
2. `02-database-and-assets.md`
3. `03-beatmap-system.md`
4. `04-audio-and-clock.md`
5. `05-input-gameplay.md`
6. `06-playfield-renderer.md`
7. `07-events-effects.md`
8. `08-skin-system.md`
9. `09-score-results.md`
10. `10-song-select-preview.md`
11. `11-settings-persistence.md`
12. `12-testing-performance.md`

The plans assume:

- GPUIX is the rendering/UI layer.
- Bun/TypeScript handles application/runtime logic.
- Roxysu's existing SQLite database is reused.
- osu!lazer remains the binary asset store.
- Gameplay is independent of rendering.
- High-frequency state stays out of React.
