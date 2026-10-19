---
cand: A1
reopens: F-002, F-011
feature: live-sync
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# A live import longer than 10 minutes is declared stale

## Problem

Stale means `now - imports.started_at > 10 min`. There is no heartbeat. The server sweep (`failStaleRunningImportsOlderThan`) marks that row failed while the reader is still writing. `importGateDecision` treats the same row as `proceed`, so a full analytics rebuild can read a half-extracted mirror. When the reader later calls `finishImport`, the row flips back to `success` and schedules another rebuild.

`claimImport` sets `startedAt` once. The only mid-import update is `setImportSchemaVersion`. Counters are written in `finishImport`.

## Potential solution

Add `imports.progress_at` (timestamp ms, nullable). Stale means no progress for `STALE_RUNNING_MS`, not a long `started_at`.

1. Migration in `packages/db` (server is the only migrator). Nullable column, no backfill. Both SQLite clients already share this schema.
2. `claimImport` sets `progressAt` to the same instant as `startedAt`.
3. Add `touchImportProgress(db, importId)`: one `UPDATE imports SET progress_at = ? WHERE id = ? AND status = 'running'`. Call it from the three long paths in `apps/realm-reader/src/sync.ts` (full, reconcile, incremental) after each streamed batch, throttled to once per 30 s. Do not call it per row, and do not put it inside `upsertBatches` (other writers use that helper).
4. `failStaleRunningImportsOlderThan` and `isStaleRunning` both compare `progress_at`, falling back to `started_at` when `progress_at` is null (rows written before the migration). Keep the 10-minute window. Do not shorten it in this change: jobs that claim an import and finish without touching still get the same grace they have today.
5. `finishImport` and `failImport` should update `WHERE status = 'running'`. A sweep that correctly failed a dead reader must not be overwritten by a late commit. A live reader is not swept, so its commit still matches.

Do this in the same change as A3. Today `waitForIdleImport` is capped by `started_at + 10 min`. After a heartbeat, that wait lasts until the import finishes. The settings `PATCH` must not sit on that wait.

## Do not

- Do not store the heartbeat in `settings`. Both processes already read `imports`.
- Do not wrap the streaming extraction in one transaction. Batches stay autocommit; the heartbeat is one short update (`knowledge/decisions/dual-runtime-sqlite-bus.md`).
- Do not treat a stale row as "proceed and rebuild". Stale still means the writer is presumed dead. The change is only what counts as stale.

## Touch

- `packages/db/src/schema.ts` — `imports.progressAt`
- `packages/db/drizzle/` — next migration
- `packages/db/src/failStaleRunningImports.ts`
- `apps/realm-reader/src/importJournal.ts` — claim, touch, finish, fail
- `apps/realm-reader/src/sync.ts` — throttled touch after each streamed batch
- `apps/server/src/analytics/pipeline.ts` — `isStaleRunning` reads `progressAt`

## Tests

- `packages/db/src/failStaleRunningImports.test.ts`: old `started_at` + fresh `progress_at` is not failed. Old `progress_at` is failed. Null `progress_at` still uses `started_at`.
- `apps/server/src/analytics/pipeline.test.ts`: `importGateDecision` waits when `started_at` is past 10 minutes but `progress_at` is fresh, and proceeds when `progress_at` is stale.
- Reader journal test: `finishImport` does not flip a row the sweep already marked `failed`.
