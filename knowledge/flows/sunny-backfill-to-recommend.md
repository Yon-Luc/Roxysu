---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/map-analysis/sunnyDanJob.ts
  - apps/server/src/map-analysis/danVariantJob.ts
  - apps/server/src/map-analysis/computeSunnyDan.ts
  - apps/server/src/tosu/analyze.ts
  - apps/server/src/analytics/recommend
  - packages/sunny-dan
---

# Flow: Sunny backfill to recommend

## User intent

Populate mania difficulty estimates so 4K/7K recommendations and `dan:`/`sunny:` filters work well.

## Flow

```
Settings POST /api/settings/sunny-dan/start
    ↓
job reads .osu from lazer files
    ↓
@roxysu/sunny-dan estimate
    ↓
persist Sunny dan ratings store (beatmap_dan_ratings)
    ↓
query language fields + GET /api/practice/recommend + Session Suggest UI
```

## Flow: modded plays → dan difficulty variants

```
server boot / sync.finished (debounced)
    ↓
dan variant job scans mania scores (full scan at boot; changed_score_ids per import)
    ↓
resolveDanVariant() → distinct combos (beatmap × rate × Invert)
    ↓
backfill reads .osu, estimates with { speedRate, cvtFlag: "IN" }
    ↓
persist beatmap_dan_rating_variants (sunny + daniel for 4K)
    ↓
skill axes / band plays / dashboard read variant stars per play
```

## Flow: mod-aware dan reads (preview / live analysis)

```
BeatmapPreviewModal pills or tosu snapshot mods (MR/IN/HO + rate)
    ↓
GET /api/beatmaps/:id/sunny-dan?mods=&rate=   |   analyze.ts sunnyFromText(cvtFlag)
    ↓
base combo → Sunny dan ratings store          | conversionCvtFlag → estimator { speedRate, cvtFlag }
modded combo → variant row if persisted, else ephemeral estimate (never persisted)
```

Single-map request paths may compute; `GET /api/practice`, `GET /api/search`,
and `GET /api/practice/recommend` still never do.

## Business guarantee

Recommendations and `dan:` / `pattern:` filters use persisted estimates only. Without the Settings jobs, 4K/7K suggest quality is limited and those filters miss unrated maps. `GET /api/practice`, `GET /api/search`, and `GET /api/practice/recommend` do not start or run Sunny/Daniel/pattern compute. Dan difficulty variants are likewise computed only by the background job — modded plays without a computed variant are excluded from skill aggregation until rated.

## Implementation references

- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `apps/server/src/map-analysis/danVariantJob.ts`
- `packages/sunny-dan`
- `apps/server/src/analytics/recommend/*`
