# Moved

Texture refresh experiments live under **`apps/play/src/playfield/`**:

- `TextureRefreshTest.tsx` — tests A / B / C (historical — informed `<surface>` PR)
- `textureRefreshTestPngs.ts` — PNG writer
- `texture-refresh-findings.md` — GPUI cache notes

**Production path:** `apps/play/docs/gpuix-surface-pr-spec.md` — GPUIX `<surface>` element (in-memory RGBA, no PNG ring).

## Run

```bash
cd apps/play

# Test B (default) — A/B ping-pong
bun run dev:texture-test

# Test A — same path overwrite
TEXTURE_TEST_MODE=A bun run dev:texture-test

# Test C — 64-path ring buffer
TEXTURE_TEST_MODE=C bun run dev:texture-test

# Higher frame rate (default is 8ms ≈ 120 Hz)
TEXTURE_TEST_FRAME_MS=4 TEXTURE_TEST_MODE=C bun run dev:texture-test   # ~240 Hz target
TEXTURE_TEST_FRAME_MS=0 TEXTURE_TEST_MODE=C bun run dev:texture-test   # uncapped

Or use the **60 / 120 / 240 / ∞** buttons in the UI.
```

Or click **Test A / B / C** in the UI.
