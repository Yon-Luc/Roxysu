---
id: F-002
feature: live-sync
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Analytics rebuilds while an import is still running

## What

The analytics pipeline waits at most five minutes for the latest `imports` row to leave `running`. On timeout it logs a warning and continues. `loadAnalyticsDelta` returns null unless that row is `success`, and a null delta forces a full analytics rebuild. Full and reconcile extraction commit raw rows in batches before `finishImport`, so the rebuild can read a half-imported mirror.

A `score.imported` event from a rising `max(played_at)` can schedule that work before the import journal is finished.

## Why

`IMPORT_WAIT_MAX_MS` is 5 minutes. A first full extraction of a large lazer library often runs longer. `waitForIdleImport` treats “still running” as permission to proceed. `isStaleRunning` (10 minutes) only stops the wait; it does not mark the import failed and does not mean the raw tables are complete.

This is a cost of the local-mirror bus (`knowledge/decisions/dual-runtime-sqlite-bus.md`): the server and realm-reader share one SQLite file, and the server does not wait for the writer to finish.

## How to improve

Do not start a full rebuild while the latest import is `running` and not stale. Gate `score.imported` scheduling on a successful import, or on `sync.finished`. If the wait expires, skip the pipeline and retry when the import row leaves `running`.

## Potential gain

Mastery, sessions, and stats are not computed from a partial library after the first sync or a long reconcile. Fewer states that only a later full rebuild repairs.

## Evidence

- `apps/server/src/analytics/pipeline.ts` `waitForIdleImport` (lines 132–142) proceeds after `IMPORT_WAIT_MAX_MS`.
- `loadAnalyticsDelta` (lines 107–120) returns null when `status !== "success"`.
- `needsFullRebuild` treats a null delta as a full rebuild.
- `apps/server/src/sse.ts` publishes `score.imported` from `max(played_at)` while an import can still be open.

## Status

Fixed. `apps/server/src/analytics/pipeline.ts`: removed the 5-minute `IMPORT_WAIT_MAX_MS` that proceeded anyway. `waitForIdleImport` now blocks until `importGateDecision` returns "proceed" (latest import is not `running`, or is stale by the 10-minute `isStaleRunning` rule), and applies to every entry point: SSE-scheduled runs (`score.imported`, `sync.finished`), the boot debounce, and forced full rebuilds. `score.imported` and `dashboard.updated` publication in `sse.ts` is unchanged, so UI refresh is unaffected. Tests: `apps/server/src/analytics/pipeline.test.ts`.
