---
id: F-065
feature: tosu-live
kind: logic-gap
severity: low
confidence: verified
status: fixed
---

# Play ticks are dropped until the first live snapshot exists

## What

SSE `tosu.updated` events with reason `play` patch the React Query cache only when a previous snapshot is already there. If the patch runs before `fetchTosuLive` resolves, the updater returns `prev` unchanged, which is `undefined`.

## Why

`setQueryData` does not create the cache entry. The clock and combo from those ticks are gone until the next full `tosu.updated`. Overlay and Now selected cold loads (including the Wayland host) hit this window.

## How to improve

When `prev` is missing, invalidate or fetch `/api/tosu/live` instead of dropping the tick.

## Potential gain

The first seconds of an overlay do not skip play updates that arrived before the snapshot.

## Evidence

- `apps/server/public/lib/sse.ts` (about lines 172–196): `if (!prev) return prev` inside the `reason === "play"` branch.

## Status

Fixed. `apps/server/public/lib/sse.ts` now routes `tosu.updated` through exported `applyTosuUpdated`; a play tick with no cached `["tosu","live"]` snapshot invalidates the query (skipped while the first fetch is already in flight) instead of being dropped. Tests in `apps/server/public/lib/sse.test.ts`.
