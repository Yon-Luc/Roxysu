---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/analytics/pipeline.ts
  - apps/realm-reader/src
---

# Flow: Score indexing & analytics

## User intent

After new plays (or deletes), keep sessions/mastery/stats consistent.

## Flow

```
import success (changedScoreIds or full)
    ↓
analytics pipeline incremental or full rebuild
    ↓
sessions / mastery / statistics updated
    ↓
SSE consumers refresh
```

## Business guarantee

Soft deletes and orphan cleanup feed session/mastery refresh; large/full syncs may force full rebuild.

## Implementation references

- `apps/server/src/analytics/pipeline.ts`
- `apps/server/src/analytics/session.ts`
- `apps/server/src/analytics/mastery/*`
