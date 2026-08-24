# Roxysu Performance & Logic Analysis

In-depth read-only audit performed 2026-08-24 across all four runtime areas.
Method: full-file reads of every module in scope, end-to-end tracing of hot
paths (search, sync cycle, hub search, replay modal), cross-checked against
`packages/db/src/schema.ts` indexes and `knowledge/`. Every critical/high
finding below was re-verified by hand against the cited lines.

## Documents

| Doc | Scope | Strongest finding |
|---|---|---|
| [server-backend.md](server-backend.md) | `apps/server/src/**` | Inline dan/pattern backfill blocks the event loop inside list requests |
| [realm-reader-and-db.md](realm-reader-and-db.md) | `apps/realm-reader/src`, `packages/db/src` | Crash between data commit and `finishImport` permanently loses analytics deltas |
| [hub.md](hub.md) | `apps/hub/src`, `packages/db/src/hub` | Per-beatmapset HTTP crawl inside POST/PUT collection handlers |
| [frontend-ui.md](frontend-ui.md) | `apps/server/public/**` | Rewatch HUD calls `setHud` every frame → whole modal re-renders at refresh rate |

## Cross-cutting themes

1. **CPU-heavy work on the Bun event loop.** The server is single-threaded per
   process; synchronous file reads (`readFileSync` of `.osu` files), zip
   building, and multi-hundred-row UPDATE loops inside request handlers stall
   *every* endpoint — including SSE, covers and the tosu proxy — whenever they
   run. Recurring pattern in `query-language/execute.ts`,
   `map-analysis/*Job.ts` callers, `mirrors/batchJob.ts`, `exportOsz.ts`.
2. **Shared-SQLite contention.** Server poller (`COUNT(*)` on `scores` every
   1.5 s), realm-reader collections rewrite (hundreds of autocommit writes per
   minute) and analytics pipelines all contend on one WAL file. Each alone is
   survivable; together they widen lock windows exactly during play sessions.
3. **Crash-window correctness.** Watermarks derived from data tables instead of
   the import journal create a silent analytics-loss window (see realm-reader
   doc, C1). Related: stale `running` import rows never swept.
4. **Unbounded growth without eviction.** `imports` table (~1 row/min forever),
   `md5ListCache`, hub rate-limit buckets >10k only pruned, SSE listener set
   only pruned on enqueue failure.
5. **Frontend idle burn + monolithic bundle.** 1.58 MB single JS chunk; replay
   modal repaints at full FPS while paused.

## Suggested fix order (highest user impact first)

1. Move dan/pattern backfill out of request paths into existing background jobs (server #1).
2. Gate SSE poll loop on active listeners / replace score COUNT probe (server #2).
3. Persist watermarks transactionally in the import journal (realm-reader C1).
4. Skip unchanged collections in `syncRealmCollectionsFromRealm`; wrap in one transaction (realm-reader H2).
5. Batch session-engine writes; restrict rescoring to affected sessions (server #4).
6. Add missing score indexes + cache username resolution (server #3).
7. Cache collection stats or move to a background job on the hub (#1).
8. Gate rewatch `setHud` on value change; add canvas dirty-checks (frontend #1/#4).
9. Lazy-load heavy routes (frontend #2).
