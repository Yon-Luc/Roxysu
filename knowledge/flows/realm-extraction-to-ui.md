---
last_verified: 2026-10
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/importJournal.ts
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
stream raw import rows in short autocommit batches (import row stays `running`)
    ↓
commit phase: one short transaction finishes the `imports` row (`success`, watermarks + changed IDs, orphan deletes together)
    ↓
server startPollLoop (sse.ts) sees new `imports` rows / non-empty changed IDs / newer `MAX(played_at)`
    ↓
analytics pipeline waits while the latest import is `running` (not stale), then runs (Retry → Session → Mastery → Statistics)
    ↓
SSE publish
    ↓
UI (public/lib/sse.ts)
```

## Business guarantee

New scores become visible and analytics refresh without restarting the app; Realm remains read-only during this path. Analytics never rebuild from a half-imported mirror: the pipeline defers (from SSE events, boot, or forced rebuilds alike) until the latest import leaves `running` or goes stale, while `score.imported` still refreshes the UI at once. A crash mid-extract cannot permanently skip analytics or leave a half-extracted mirror that looks complete: only the commit phase marks an import `success`, and the next cycle re-reads from the last successful watermark (or runs a full extraction when none exists).

When `client.realm` is a newer schema than this build, extraction records `sync.schema_outdated` and stops retrying. The client app shows a non-dismissible notice (a matching version is coming; GitHub has more info) until a later Realm open succeeds and clears the setting.

## Implementation references

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/importJournal.ts` — `commitImport()`
- `apps/realm-reader/src/schemaMismatch.ts`
- `apps/server/src/sse.ts`
- `apps/server/src/routes/system.ts`
- `apps/server/public/components/SchemaOutdatedDialog.tsx`
- `apps/server/src/analytics/pipeline.ts`
