---
id: F-034
feature: map-marathon
kind: perf
severity: medium
confidence: verified
---

# Marathon export decodes every track into one PCM buffer

## What

`generateMarathonOsz` decodes each source to an `AudioBuffer`, resamples to stereo 44.1 kHz, allocates one `Float32Array` for the whole marathon plus pauses, and wraps that in an uncompressed WAV.

## Why

The cap is 12 maps. Twelve long songs are hundreds of megabytes of decoded audio on the main thread, before the osz is packed. The feature notes already call marathon fragile; this is a concrete reason.

## How to improve

Concat in chunks, cap total duration, and prefer a compressed audio codec over a full WAV. Move the decode off the main thread.

## Potential gain

Marathon generation finishes on a typical laptop instead of exhausting the tab.

## Evidence

- `apps/server/public/lib/marathonExport.ts` (lines 85–97): decode every source, then `mixAudio`.
- `mixAudio` (about lines 200–221): one `Float32Array` pair sized to the full concatenation.
