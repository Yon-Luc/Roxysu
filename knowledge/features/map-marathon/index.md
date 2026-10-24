---
last_verified: 2026-10
confidence: verified
touches:
  - packages/osu-chart/src/fuse.ts
  - packages/osu-chart/src/write.ts
  - apps/server/src/routes/marathon.ts
  - apps/server/public/lib/marathonExport.ts
  - apps/server/public/features/marathon/MarathonPage.tsx
  - apps/server/public/components/AppShell.tsx
  - apps/server/public/components/CommandPalette.tsx
---

# Map marathon

## Purpose

Let the user fuse several same-key mania beatmaps into one playable chart, then import that `.osz` into osu!lazer the same way Download opens archives.

## Business meaning

A **Map marathon** is one new unsubmitted mania difficulty: songs play back-to-back with a short silence, notes and timing (including SV) are offset to match the concatenated audio, and the background is a grid collage of the source images.

## Business rules

0. Sidebar, mobile More sheet, and command palette hide `/marathon` while the feature is still buggy (`HIDDEN_NAV` / `HIDDEN_PAGES`). The route remains reachable by URL.
1. Mania only. Every source must share one key count. The page enforces this when a map is added and when `?ids=` loads sources (search add, recommend fill, and the initial-ids effect all call `partitionByKeyCount` and toast the rejected maps); `generate` keeps the same check as a backstop. The sources route still returns mixed keys; the page decides.
2. Between 2 and 12 maps. Sources without local audio (or a readable `.osu`) are skipped, not listed.
3. Pause between songs is user-chosen (0–5000 ms, default 2000). Audio duration is the decoded file length, not last-note time.
4. Chart fusion lives in `@roxysu/osu-chart` (`fuseManiaCharts`). Lazer mania scroll uses inherited SV / effect `ScrollSpeed` only (`-100` = 1.0×); `SliderMultiplier` is not applied, and a red line resets scroll to 1.0. Greens are copied as-is. Notes and timing points at or after a song’s audio duration are clipped so they cannot leak into the next song. At each song start a red line + the original starting SV is written. Custom hitsound files are not packed. After fuse, in-window notes and BPM/SV are checked against the originals.
5. The client app does not write Realm. The `.osz` is written to the beatmaps download folder and opened with `openOszWithOsu`.
6. 4K/7K recommend can fill the track list (`GET /api/practice/recommend`), optionally filtered to a dan tier (`dan:"Regular 9"`, `dan:"Gamma"`, …). Sessions recommend can send its current list to `/marathon`.
7. Audio is built track by track: each source is decoded, resampled to 44.1 kHz stereo, encoded to 16-bit PCM and released before the next decode (`mixTracksToWav` returns those chunks). The export packs them as one uncompressed WAV (zip method 0: header, then each chunk) and does not assemble a second WAV buffer. Total audio (including pauses) is capped at 60 minutes and fails with an explicit error; silent output also fails. The output format and per-song timing offsets are unchanged.
8. Generation is cancellable from the page (Cancel button, `AbortController` passed as `signal`) until the packed `.osz` is sent to `open-in-osu`; the signal is checked between tracks, and an abort raises no error toast.

## Main flows

```
pick maps (search or 4K/7K recommend)
    ↓
POST /api/marathon/sources → .osu text + audio/bg hashes
    ↓
    browser: decode audio → silence → WAV → collage → fuse .osu → zip
    ↓
POST /api/marathon/open-in-osu → save + openOszWithOsu
```

## Important symbols

- `packages/osu-chart/src/fuse.ts:fuseManiaCharts()`
- `apps/server/src/routes/marathon.ts`
- `apps/server/public/lib/marathonExport.ts:generateMarathonOsz()`
- `apps/server/public/lib/marathonExport.ts:mixTracksToWav()`, `partitionByKeyCount()`
- `apps/server/public/features/marathon/MarathonPage.tsx`
- `apps/server/src/mirrors/openInOsu.ts:openOszWithOsu()`

## Dependencies

- `features/practice-library/` — search to add maps
- `features/rework-dan-recommendations/` — 4K/7K fill
- `features/download-mirrors/` — beatmaps folder + open-in-osu
- `packages/osu-chart`

## Depended on by

- (none)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Map marathon
- [flows/generate-map-marathon.md](../../flows/generate-map-marathon.md)
- [business/realm-read-only.md](../../business/realm-read-only.md)
