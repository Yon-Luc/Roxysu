---
last_verified: 2026-08
confidence: verified
touches:
  - packages/osu-chart/src/fuse.ts
  - packages/osu-chart/src/write.ts
  - apps/server/src/routes/marathon.ts
  - apps/server/public/lib/marathonExport.ts
  - apps/server/public/features/marathon/MarathonPage.tsx
---

# Map marathon

## Purpose

Let the user fuse several same-key mania beatmaps into one playable chart, then import that `.osz` into osu!lazer the same way Download opens archives.

## Business meaning

A **Map marathon** is one new unsubmitted mania difficulty: songs play back-to-back with a short silence, notes and timing (including SV) are offset to match the concatenated audio, and the background is a grid collage of the source images.

## Business rules

1. Mania only. Every source must share one key count.
2. Between 2 and 12 maps. Sources without local audio (or a readable `.osu`) are skipped, not listed.
3. Pause between songs is user-chosen (0–5000 ms, default 2000). Audio duration is the decoded file length, not last-note time.
4. Chart fusion lives in `@roxysu/osu-chart` (`fuseManiaCharts`). Inherited timing points are preserved. Custom hitsound files are not packed. After fuse, each segment’s notes and BPM/SV are checked against the original charts (`checkFusedMatchesOriginals`); a mismatch aborts generate.
5. The client app does not write Realm. The `.osz` is written to the beatmaps download folder and opened with `openOszWithOsu`.
6. 4K/7K recommend can fill the track list (`GET /api/practice/recommend`). Sessions recommend can send its current list to `/marathon`.

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
- `apps/server/public/features/marathon/MarathonPage.tsx`
- `apps/server/src/mirrors/openInOsu.ts:openOszWithOsu()`

## Dependencies

- `features/practice-library/` — search to add maps
- `features/sunny-dan-recommendations/` — 4K/7K fill
- `features/sessions/` — Send to marathon
- `features/download-mirrors/` — beatmaps folder + open-in-osu
- `packages/osu-chart`

## Depended on by

- (none)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Map marathon
- [flows/generate-map-marathon.md](../../flows/generate-map-marathon.md)
- [business/realm-read-only.md](../../business/realm-read-only.md)
