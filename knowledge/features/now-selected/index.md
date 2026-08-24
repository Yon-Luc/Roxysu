---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/now-selected
  - apps/server/public/components/BeatmapPreviewEmbed.tsx
  - apps/server/public/components/mania-analysis
  - apps/server/src/tosu/live.ts
  - apps/server/src/tosu/analyze.ts
  - apps/server/src/routes/tosu.ts
  - apps/server/src/routes/beatmaps.ts
  - apps/server/public/lib/useTosuLiveQuery.ts
  - apps/server/public/router.tsx
  - apps/server/public/components/AppShell.tsx
---

# Now selected

## Purpose

Second-monitor companion page for the beatmap currently selected in osu! (via **tosu live**): identity, auto preview, mania pattern weights, density over time, and live play stats. Layout is user-configurable.

## Business meaning

While song-selecting or playing, open **Now selected** (optionally `#/now-selected?focus=1`) on another display to see chart analysis and preview without leaving the game.

## Business rules

1. **tosu live** is the selection source — not scores. Realm extraction remains authoritative for plays.
2. The Current session **Now selected** panel stays as a compact hub; this page is the rich companion.
3. Preview auto-starts when the map is matched in the local mirror and in-game play is not active (configurable). Pause while `play.active` avoids doubling game audio.
4. Preview position syncs with tosu `beatmap.time.live`: while tosu samples are fresh (≤1.5s old), `BeatmapPreviewEmbed` drives its playfield clock from the live time (interpolated at the tosu rate) and hard-corrects local audio when it drifts >350ms; otherwise it falls back to independent playback from the preview point.
5. Pattern weights / density / hotspots use the same `ManiaPatternDetail` path as the practice profile (unrated chart).
6. Maps not in the local mirror still show identity + ephemeral mania analysis from tosu `.osu` text; preview is skipped.
7. Widget visibility and order are page-local (`localStorage` key `roxysu:now-selected-layout`), not the Settings HTTP store.
8. Focus layout (`?focus=1`) hides AppShell chrome (sidebar, mobile nav) for a second monitor.
9. Personal play count / best accuracy / best PP use `GET /api/beatmaps/:id/stats`, not the full practice-profile payload.
10. Live play ticks patch the tosu live query cache (`tosu.updated` `reason: play`). HTTP poll of `GET /api/tosu/live` runs only when SSE is down.

## Security rules

None — client app has no user auth; tosu is a local process.

## Main flows

```
tosu WS frame
  ↓
tosu live adapter (lean snapshot + cached ManiaPatternDetail on checksum change)
  ↓
GET /api/tosu/live  →  NowSelectedPage (SSE tosu.updated; poll only if SSE down)
GET /api/tosu/live/analysis  →  pattern weights / density (when checksum stable)
matchedBeatmapId  →  GET /api/beatmaps/:id/stats (play count / best acc / best PP)
matchedBeatmapId  →  BeatmapPreviewEmbed → GET /api/beatmaps/:id/preview
beatmap.time.live (SSE play ticks) → BeatmapPreviewEmbed clock sync
```

## Important symbols

- `apps/server/public/features/now-selected/NowSelectedPage.tsx`
- `apps/server/public/features/now-selected/nowSelectedLayout.ts`
- `apps/server/public/lib/useTosuLiveQuery.ts`
- `apps/server/public/components/BeatmapPreviewEmbed.tsx`
- `apps/server/public/components/mania-analysis/*`
- `apps/server/src/tosu/live.ts` — `getTosuLiveSnapshot()`, `getTosuLiveAnalysis()`
- `apps/server/src/routes/beatmaps.ts` — `GET /:id/stats`
- `apps/server/src/map-analysis/computePatternAnalysis.ts` — `analyzeManiaPatternDetail()`

## Dependencies

- `features/tosu-live/` — live selected beatmap
- `features/preview-replay/` — embedded preview playfield
- `features/practice-profiles/` — shared mania analysis widgets
- `features/sessions/` — same tosu live snapshot as Current session panel

## Depended on by

- (entry surface; no feature depends on this page specifically)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Now selected
- [features/tosu-live/](../tosu-live/index.md)
- [features/preview-replay/](../preview-replay/index.md)
- [features/practice-profiles/](../practice-profiles/index.md)
- [architecture/client-theme.md](../../architecture/client-theme.md) — embedded preview uses `on-media` text
