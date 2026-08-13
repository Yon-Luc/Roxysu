---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/server/src/sse.ts
  - apps/server/src/analytics/pipeline.ts
  - apps/server/public/lib/sse.ts
---

# Flow: Realm sync to UI

## User intent

Keep the practice UI current as new plays appear in lazer.

## Flow

```
realm-reader poll/watermark sync
    ↓
write raw tables + imports row
    ↓
server startPollLoop (sse.ts) sees new imports
    ↓
analytics pipeline (Retry → Session → Mastery → Statistics)
    ↓
SSE publish
    ↓
UI (public/lib/sse.ts)
```

## Business guarantee

New scores become visible and analytics refresh without restarting the app; Realm remains read-only during this path.

## Implementation references

- `apps/realm-reader/src/index.ts`
- `apps/server/src/sse.ts`
- `apps/server/src/analytics/pipeline.ts`
