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

Populate mania difficulty estimates so 7K recommendations and `dan:`/`sunny:` filters work well.

## Flow

```
Settings POST /api/settings/sunny-dan/start
    ↓
job reads .osu from lazer files
    ↓
@roxysu/sunny-dan estimate
    ↓
cache beatmap_dan_ratings
    ↓
QL fields + GET /api/practice/recommend + Session Suggest UI
```

## Business guarantee

Recommendations use cached estimates; without backfill, 7K suggest quality is limited.

## Implementation references

- `apps/server/src/map-analysis/sunnyDanJob.ts`
- `packages/sunny-dan`
- `apps/server/src/analytics/recommend/*`
