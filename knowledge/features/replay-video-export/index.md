---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/lib/replayVideoExport.ts
  - apps/server/public/lib/paintStdPlayfield.ts
  - apps/server/public/lib/paintManiaNotefield.ts
  - apps/server/public/lib/paintTaikoPlayfield.ts
  - apps/server/public/lib/paintCatchPlayfield.ts
  - apps/server/public/components/ScoreReplayModal.tsx
  - apps/server/public/components/ReplayVideoExportOptionsModal.tsx
  - apps/server/package.json
---

# Replay video export

## Purpose

Let the user download a score rewatch as an MP4 (playfield + beatmap audio)
without leaving the client app.

## Business meaning

**Replay video export** turns an already-loaded score rewatch into a shareable
video file. It is an offline, browser-side encode of the rewatch page composition
(background, header info, skinned playfield, HUD, stats) — not a server render
and not a live screen capture.

## Business rules

1. Supported rulesets: **mania**, **standard** (`osu`), **taiko**, and **catch**
   (`fruits`) — same as score rewatch.
   **Status:** verified — `exportReplayVideo` guards on ruleset short name.

2. Timeline is **map time at 1×**. UI playback rate and DT/HT rate do not stretch
   the export; mania scroll uses the user's current scroll preference with
   `playbackRate: 1`.
   **Status:** verified — `replayVideoExport.ts`.

3. Frame composition mirrors the score rewatch page: beatmap background, top-left
   title / subtitle / mods, playfield at modal-like scale with the user's skin
   (std or mania preview skin, scroll, hit position, lane cover, field width),
   live combo/accuracy HUD, and bottom stored/sim stats with a Roxysu logo +
   wordmark watermark on the bottom left. Control buttons
   (Rewatch / Play / Export / Window / Esc) are omitted.
   **Status:** verified — `paintComposedFrame` in `replayVideoExport.ts`.

4. Export presets: Discord (tight crop, HUD below, trimmed, ~20 MB cap),
   TikTok/HQ (same tight crop at 60fps very-high quality, no size cap), 720p,
   1080p, Compact. User can toggle hide-background; size estimate updates.
   **Status:** verified — `REPLAY_VIDEO_EXPORT_PRESETS`,
   `ReplayVideoExportOptionsModal`, `computeFitBitrates`, `layoutTightCanvas`,
   `exportTimeWindow`.

5. Encode strategy follows mediabunny guidance: Discord/Compact use CBR toward
   the 20 MB budget plus a 5s keyframe interval; uncapped presets (TikTok/HQ,
   720p, 1080p) use quantizer VBR with a resolution-scaled bitrate fallback.
   **Status:** verified — `buildVideoEncodeQuality`, `suggestedVideoBitrateBps`,
   `videoKeyFrameIntervalSec`, `computeFitBitrates`.

6. Export is cancelable; closing the modal or changing score aborts the job.
   **Status:** verified — `AbortSignal` in `ScoreReplayModal`.

7. Output filename: `{artist} - {title} [{diff}] ({userUsername}).mp4`.
   **Status:** verified — `buildReplayVideoFilename`.

## Security rules

None beyond existing local score/audio access in the client app (no Hub upload,
no auth gate).

## Important states

- **Idle** — Export button available in rewatch for mania/standard/taiko/catch.
- **Options** — quality preset modal (Discord / 720p / 1080p / Compact) with
  size estimate and hide-background toggle.
- **Encoding** — overlay with progress; live audio paused.
- **Done** — browser download of the MP4 blob.
- **Failed / cancelled** — error text or silent cancel; button re-enabled.

## Main flows

```text
user opens score rewatch → clicks Export
  → ReplayVideoExportOptionsModal (preset + hide background + size estimate)
  → decode beatmap audio (+ background unless hidden)
  → for each frame at fixed FPS:
        compose background + header + paintStd/paintMania/paintTaiko/paintCatch + HUD + stats
        CanvasSource.add(t, 1/fps)
  → AudioBufferSource.add(sliced buffer)
  → finalize MP4 → downloadBlob
```

## Implementation

- `lib/replayVideoExport.ts` — presets, size estimate, mediabunny encode + compose.
- `ReplayVideoExportOptionsModal.tsx` — quality / hide-background chooser.
- Pure paint modules drive frames (no rAF during encode).
- UI entry: Export control + progress overlay in `ScoreReplayModal.tsx`.

## Important symbols

- `apps/server/public/lib/replayVideoExport.ts:exportReplayVideo()`
- `apps/server/public/lib/replayVideoExport.ts:downloadBlob()`
- `apps/server/public/lib/paintStdPlayfield.ts:paintStdPlayfield()`
- `apps/server/public/lib/paintManiaNotefield.ts:paintManiaNotefield()`
- `apps/server/public/lib/paintTaikoPlayfield.ts:paintTaikoPlayfield()`
- `apps/server/public/lib/paintCatchPlayfield.ts:paintCatchPlayfield()`

## Dependencies

- [preview-replay/](../preview-replay/index.md) — score rewatch payload + paint
- `mediabunny` — browser WebCodecs muxer/encoder
- Beatmap audio route (`/api/audio/:hash`)

## Depended on by

None yet.

## Side effects

Downloads a file in the browser; pauses rewatch audio while encoding. Does not
write to Realm, the local mirror, or the Hub store.

## Failure behavior

- Missing audio / unsupported ruleset / no encodable codecs → user-visible error.
- Abort → no download; overlay dismissed.
- Encoder empty buffer → throws.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Score rewatch, Replay video export
- [flows/export-replay-video.md](../../flows/export-replay-video.md)
- [preview-replay/](../preview-replay/index.md)
