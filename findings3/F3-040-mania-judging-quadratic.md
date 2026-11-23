---
id: F3-040
feature: preview-replay
kind: perf
severity: medium
confidence: verified
status: proposed
---

# Mania judging is O(frames x notes) on a synchronous block

## What

`missExpiredNotes` walks every note in every column on every frame, and `findHeldNote` walks the
whole column queue on every release. Neither is capped by anything but `MAX_REPLAY_FRAMES`
(1,000,000).

A replay that toggles a key every line - 8 bytes per frame, well under the 16 MiB decompressed
cap - against a 2-3k-note chart is roughly 2.5e9 iterations inside a single non-yielding
`compute()` under `judgeCached`, with a second slot allowed by `REPLAY_HEAVY_CONCURRENCY = 2`.
That freezes the whole client app - HTTP routes, SSE and the mirror writers - for tens of
seconds, twice.

## Why

The expiry walk is `for (let i = 0; i < q.length; i++)` per column per frame, and the release
lookup scans the same queue. `decode.ts` allows 1M frames and `replayRuntime.ts` calls
`compute()` once with no yield inside.

## How to improve

Keep a per-column pointer to the earliest note whose tail is not judged. Notes are start-sorted,
so tails are near-sorted: advance the pointer monotonically instead of rescanning.

Track the set of `holding` notes per column rather than scanning for them.

Optionally budget `frames x notes` and reject above a threshold with the existing 422 message,
which also covers the pathological replay case.

## Evidence

- `packages/mania-judge/src/simulate.ts:138-168` - per-frame scans
- `apps/server/src/replay/decode.ts:59-62`, `:224-227` - frame cap
- `apps/server/src/replay/replayRuntime.ts:105-106`, `:200-206` - single `compute()` call
