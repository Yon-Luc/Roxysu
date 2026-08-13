---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/lib/replayVideoExport.ts
  - apps/server/public/components/ScoreReplayModal.tsx
---

# Export score rewatch as video

## User intent

Download the current score rewatch as an MP4 to share or archive.

## Flow

```text
ScoreReplayModal (rewatch)
  → Export
  → ReplayVideoExportOptionsModal (preset + hide background + size estimate)
  → exportReplayVideo()
       ├── decodeAudioData(localBeatmapAudioUrl)
       ├── optional background (unless Discord / hide-bg)
       ├── paint composed frames @ preset fps
       ├── mediabunny CanvasSource + AudioBufferSource → Mp4OutputFormat
       └── downloadBlob(filename)
```

## Business guarantee

The file shows the same playfield content as rewatch (skin, judgments, cursor /
keys) with beatmap audio, at map time 1×, without uploading anywhere.

## Implementation references

- `apps/server/public/lib/replayVideoExport.ts:exportReplayVideo()`
- `apps/server/public/components/ScoreReplayModal.tsx` (Export control)

## Related knowledge

- [features/replay-video-export/](../features/replay-video-export/index.md)
- [features/preview-replay/](../features/preview-replay/index.md)
