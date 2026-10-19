---
id: F-032
feature: replay-video-export
kind: perf
severity: medium
confidence: verified
---

# Video export keeps the whole MP4 in memory

## What

Export muxes into a `BufferTarget`. After `finalize`, the code reads `target.buffer` and wraps it in a `Blob` for download.

## Why

1080p60 over a long score, even trimmed, is hundreds of megabytes of RAM in the renderer before the download starts. Weaker machines tab-crash on marathon-length replays.

## How to improve

Write through `FileSystemWritableFileStream` where the browser allows it. Otherwise lower the default preset when the clip duration is long.

## Potential gain

Long exports finish on machines that cannot hold the whole file in the page heap.

## Evidence

- `apps/server/public/lib/replayVideoExport.ts` (about lines 1376–1377 and 1511–1515): `new BufferTarget()`, then `new Blob([buffer])`.
