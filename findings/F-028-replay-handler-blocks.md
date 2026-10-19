---
id: F-028
feature: preview-replay
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Replay route reads, decodes, and judges on the request thread

## What

The replay handler `readFileSync`s the `.osr`, decodes every frame, runs the judgment sim, and returns the full chart plus every frame in one JSON body.

## Why

Long standard or mania scores are multi-megabyte responses and a stretch of synchronous work on the process that also serves the rest of the UI. The size cap in F-005 bounds hostile files; ordinary long replays still block.

## How to improve

Cache the judgment summary. Return frames in ranges, or a thin payload when the client already has the chart from preview. Move decode off the request if the runtime allows a worker.

## Potential gain

Opening rewatch does not stall other API calls for the length of the replay.

## Evidence

- `apps/server/src/routes/scores.ts` (about lines 100–110 and 194–210): `readFileSync`, `decodeLegacyReplay`, then `hitObjects` and `stdFrames` in the JSON body.

## Status

Fixed (partly). New `replay/replayRuntime.ts`: async `stat`/`readFile` instead of `readFileSync`; decoded replays cached by score id + file mtime + size (16 entries / ~96 MiB estimated); `{judgments, summary}` cached per replay key + mods + chart fingerprint (64 entries / ~32 MiB estimated); decode and judging run under a FIFO `ConcurrencyLimiter` (2) and judging yields to the event loop first. `routes/scores.ts` uses these for all four rulesets. Tests: `replay/replayRuntime.test.ts` (cache hit skips re-judging, limiter bounds concurrency, LRU eviction, 404/422 paths). Not done: no worker thread (judging is still synchronous on the server process, only bounded and yielded), and the `stdFrames` payload is still returned by default because `ScoreReplayModal` and `replayVideoExport` consume it and are owned by another change.
