---
id: F-036
feature: tosu-live
kind: perf
severity: medium
confidence: verified
---

# Connected tosu probe still publishes a full live update

## What

Every 15 seconds, if the websocket is already `connected`, the probe loop calls `refreshProbeAndMaybeSpawn` and then `emit(true)`. `emit(true)` publishes `tosu.updated` with reason `full`. Clients refetch `/api/tosu/live`.

## Why

The probe is a liveness check. Nothing in that path compares the snapshot. Overlay and Now selected pay for a full refetch on a timer while play ticks are already streaming.

## How to improve

On a connected probe, update warnings only. Publish `tosu.updated` when status, checksum, or analysis actually changes.

## Potential gain

Less SSE refetch traffic and fewer HUD redraws that are not tied to gameplay.

## Evidence

- `apps/server/src/tosu/live.ts` `startProbeLoop` (lines 344–355): connected branch ends in `emit(true)`.
- `emit` (lines 62–77): `force` publishes `{ type: "tosu.updated", reason: "full" }`.
