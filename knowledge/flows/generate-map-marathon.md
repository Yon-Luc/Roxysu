---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/marathon/MarathonPage.tsx
  - apps/server/public/lib/marathonExport.ts
  - apps/server/src/routes/marathon.ts
  - packages/osu-chart/src/fuse.ts
---

# Generate a map marathon

## User intent

Turn an ordered list of same-key mania maps into one chart and import it into lazer.

## Flow

```
user orders 2–12 mania maps (search or 4K/7K recommend)
    ↓
POST /api/marathon/sources
    ↓
browser decodes each audio file, inserts pause, writes WAV (osu! cannot play AAC/M4A)
    ↓
fuseManiaCharts offsets notes + timing points by audio duration + pause
    ↓
checkFusedMatchesOriginals compares each segment’s notes + BPM/SV to the source charts
    ↓
canvas grid collage of local backgrounds
    ↓
zip .osu + audio + bg.jpg
    ↓
POST /api/marathon/open-in-osu
    ↓
write to beatmaps download dir + writeOsuImportScripts + openOszWithOsu
```

## Business guarantee

Realm is not written. The user imports a new unsubmitted set through lazer’s normal `.osz` handler.

## Implementation references

- `apps/server/public/features/marathon/MarathonPage.tsx`
- `apps/server/public/lib/marathonExport.ts:generateMarathonOsz()`
- `packages/osu-chart/src/fuse.ts:fuseManiaCharts()`
- `apps/server/src/routes/marathon.ts`
- `apps/server/src/mirrors/openInOsu.ts:openOszWithOsu()`
