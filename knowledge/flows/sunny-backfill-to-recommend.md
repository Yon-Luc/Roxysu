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

Recommendations use persisted estimates; without backfill, 4K/7K suggest quality is limited. `GET /api/practice/recommend` does not start Sunny backfill.

## Implementation references

- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `packages/sunny-dan`
- `apps/server/src/analytics/recommend/*`
