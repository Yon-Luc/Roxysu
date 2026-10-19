---
id: F-032
feature: replay-video-export
kind: perf
severity: medium
confidence: verified
status: fixed
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

## Status

Fixed. Uncapped presets (TikTok/HQ, 720p, 1080p) stream to a file the user picks with `showSaveFilePicker` (`pickReplayVideoSaveHandle`, called in the Export click before any await) through a mediabunny `StreamTarget` with `fastStart: false`. Discord and Compact (`fitUnderBytes`) keep the in-memory `BufferTarget` and fast-start layout. Without the File System Access API, `ReplayVideoExportOptionsModal` shows a warning and a Switch to Compact button when the estimate exceeds `REPLAY_VIDEO_MEMORY_WARN_BYTES` (192 MiB); the buffer is released after the Blob is built. Tests in `lib/replayVideoExport.test.ts`. Judgement call: streamed files keep the moov box at the end (no fast start), so web players need the full file before playback.
