---
last_verified: 2026-10
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
  - apps/server/public/lib/ratingDisplay.ts
  - apps/server/public/router.tsx
  - apps/server/public/components/AppShell.tsx
---

# Now selected

## Purpose

Second-monitor companion page for the beatmap currently selected in osu! (via **tosu live**): identity, auto preview, chart shape, density over time, and live play stats. Layout is user-configurable.

## Business meaning

While song-selecting or playing, open **Now selected** (optionally `#/now-selected?focus=1`) on another display to see chart analysis and preview without leaving the game.

## Business rules

1. **tosu live** is the selection source — not scores. Realm extraction remains authoritative for plays.
2. The Current session **Now selected** panel stays as a compact hub; this page is the rich companion.
3. Preview auto-starts when the map is matched in the local mirror and in-game play is not active (configurable). Pause — the user Pause control, or pause while `play.active` — freezes the playfield clock and the audio so game audio is not doubled. While that hold is set, tosu time must not move or seek the preview. Playback resumes from the frozen time. The hold clears only once local time and tosu time are already within ~2s; a new map starts the hold clear.
4. While the preview is playing and not held, position syncs with tosu `beatmap.time.live`: while tosu samples are fresh (≤1.5s old), `BeatmapPreviewEmbed` drives its playfield clock from the live time (interpolated at the tosu rate); small transport-latency offsets are ignored — the clock keeps gliding — and clock + audio hard-resync only when drift exceeds ~2s; otherwise it falls back to independent playback from the preview point.
5. The embed volume slider writes `volume` on the shared preview prefs store (`rx-beatmap-preview`). Changing maps remounts the embed and reloads that value, so a volume the user set stays. The slider is shown for every ruleset.
6. Chart shape bars, density, and hotspots use the same `ManiaPatternDetail` path as the practice profile (unrated chart). The shape widget lists chart-shape families for the key count (`shapeComposition`), sorted by share descending; its heading reads "Patterns". Density and hotspots still label each time window with the dominant skill.
7. Maps not in the local mirror still show identity + ephemeral mania analysis from tosu `.osu` text; preview is skipped.
8. Widget visibility and order are page-local (`localStorage` key `roxysu:now-selected-layout`), not the Settings HTTP store.
9. Focus layout (`?focus=1`) hides AppShell chrome (sidebar, mobile nav) for a second monitor. While no map is selected, connection status and Start tosu share one panel. Live play shows combo, accuracy, misses, and PP as separate figures.
10. Personal play count / best accuracy / best PP use `GET /api/beatmaps/:id/stats`, not the full practice-profile payload.
11. Live play ticks patch the tosu live query cache (`tosu.updated` `reason: play`). HTTP poll of `GET /api/tosu/live` runs only when SSE is down.
12. The analysis rating widget shows ephemeral `analysis.rework` (Rework dan + ★). Same content on the Current session **Now selected** panel.

## Security rules

None — client app has no user auth; tosu is a local process.

## Main flows

```
tosu WS frame
  ↓
tosu live adapter (lean snapshot + cached ManiaPatternDetail on checksum change)
  ↓
GET /api/tosu/live  →  NowSelectedPage (SSE tosu.updated; poll only if SSE down)
GET /api/tosu/live/analysis  →  chart shape / density (when checksum stable)
matchedBeatmapId  →  GET /api/beatmaps/:id/stats (play count / best acc / best PP)
matchedBeatmapId  →  BeatmapPreviewEmbed → GET /api/beatmaps/:id/preview
beatmap.time.live (SSE play ticks) → BeatmapPreviewEmbed clock sync
```

## Important symbols

- `apps/server/public/features/now-selected/NowSelectedPage.tsx`
- `apps/server/public/features/now-selected/nowSelectedLayout.ts`
- `apps/server/public/lib/useTosuLiveQuery.ts`
- `apps/server/public/lib/ratingDisplay.ts`
- `apps/server/public/components/BeatmapPreviewEmbed.tsx`
- `apps/server/public/components/mania-analysis/*`
- `apps/server/src/tosu/live.ts` — `getTosuLiveSnapshot()`, `getTosuLiveAnalysis()`
- `apps/server/src/tosu/analyze.ts` — ephemeral sunny + rework estimates
- `apps/server/src/routes/beatmaps.ts` — `GET /:id/stats`
- `apps/server/src/map-analysis/computePatternAnalysis.ts` — `analyzeManiaPatternDetail()`

## Dependencies

- `features/tosu-live/` — live selected beatmap
- `features/preview-replay/` — embedded preview playfield
- `features/practice-profiles/` — shared mania analysis widgets
- `features/sessions/` — same tosu live snapshot as Current session panel
- `features/mastery-settings/` — rating display mode

## Depended on by

- (entry surface; no feature depends on this page specifically)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Now selected
- [features/tosu-live/](../tosu-live/index.md)
- [features/preview-replay/](../preview-replay/index.md)
- [features/practice-profiles/](../practice-profiles/index.md)
- [architecture/client-theme.md](../../architecture/client-theme.md) — embedded preview uses `on-media` text
