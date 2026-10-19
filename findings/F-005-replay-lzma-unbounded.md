---
id: F-005
feature: preview-replay
kind: security
severity: high
confidence: verified
status: fixed
---

# Replay decode does not cap decompressed size

## What

`decodeLegacyReplay` checks that the LZMA payload fits in the `.osr` bytes, then decompresses it with no limit on output size or frame count. `GET /scores/:id/replay` runs that decode on the server for whatever file the score row points at in the lazer files store.

## Why

Compressed length is not a bound on decoded length. A truncated or hostile replay can expand to a very large allocation, then get parsed into frames, on the process that also serves the UI.

## How to improve

Cap decompressed bytes (on the order of 8–16 MB) and cap frame count after parse. Fail the request with 422 when either cap is hit. Do this inside `decompress` / `decodeLegacyReplay` so every caller is covered.

## Potential gain

One replay request cannot exhaust memory or stall the client app for the rest of the library.

## Evidence

- `apps/server/src/replay/decode.ts` (lines 88–97): compressed length is checked against `r.remaining`, then `decompress(compressed)` runs with no output cap.
- `apps/server/src/routes/scores.ts` calls `decodeLegacyReplay` on the replay route after `readFileSync`.

## Status

Fixed. `apps/server/src/replay/decode.ts` adds `MAX_REPLAY_DECOMPRESSED_BYTES` (16 MiB), `MAX_REPLAY_FRAMES` (1,000,000), and `decompressReplayBounded()`. It rejects an oversized declared LZMA header length up front, then decodes through the streaming decoder and cancels once output passes the cap (the library has no max-output option, and the header size can be "unknown"). `parseLegacyFrames` throws past the frame cap. Both errors flow through the existing 422 path in `routes/scores.ts`. Tests in `replay/decode.test.ts`.
