---
id: F-065
feature: tosu-live
kind: logic-gap
severity: low
confidence: verified
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
