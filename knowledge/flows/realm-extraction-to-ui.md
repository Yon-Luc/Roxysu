---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/server/src/sse.ts
  - apps/server/src/analytics/pipeline.ts
  - apps/server/public/lib/sse.ts
---

# Flow: Realm extraction to UI

## User intent

Keep the practice UI current as new plays appear in lazer.

## Flow

```
realm-reader poll / persisted-watermark extraction
    ↓
persist raw import tables + imports row (watermarks + changed IDs together)
    ↓
server startPollLoop (sse.ts) sees new `imports` rows / non-empty changed IDs / newer `MAX(played_at)`
    ↓
analytics pipeline (Retry → Session → Mastery → Statistics)
    ↓
SSE publish
    ↓
UI (public/lib/sse.ts)
```

## Business guarantee

New scores become visible and analytics refresh without restarting the app; Realm remains read-only during this path. A crash mid-extract cannot permanently skip analytics: the next cycle re-reads from the last successful watermark.

## Implementation references

- `apps/realm-reader/src/index.ts`
- `apps/server/src/sse.ts`
- `apps/server/src/analytics/pipeline.ts`
