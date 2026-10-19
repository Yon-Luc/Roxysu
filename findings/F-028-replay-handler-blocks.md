---
id: F-028
feature: preview-replay
kind: perf
severity: medium
confidence: verified
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
