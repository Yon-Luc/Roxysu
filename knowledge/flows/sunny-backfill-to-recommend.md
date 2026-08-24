---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/map-analysis/sunnyDanJob.ts
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

## Business guarantee

Recommendations and `dan:` / `pattern:` filters use persisted estimates only. Without the Settings jobs, 4K/7K suggest quality is limited and those filters miss unrated maps. `GET /api/practice`, `GET /api/search`, and `GET /api/practice/recommend` do not start or run Sunny/Daniel/pattern compute.

## Implementation references

- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `packages/sunny-dan`
- `apps/server/src/analytics/recommend/*`
