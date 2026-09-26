---
last_verified: 2026-09
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

When `client.realm` is a newer schema than this build, extraction records `sync.schema_outdated` and stops retrying. The client app shows a non-dismissible notice (a matching version is coming; GitHub has more info) until a later Realm open succeeds and clears the setting.

## Implementation references

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/schemaMismatch.ts`
- `apps/server/src/sse.ts`
- `apps/server/src/routes/system.ts`
- `apps/server/public/components/SchemaOutdatedDialog.tsx`
- `apps/server/src/analytics/pipeline.ts`
