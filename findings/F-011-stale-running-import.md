---
id: F-011
feature: live-sync
kind: logic-gap
severity: medium
confidence: verified
status: fixed
---

# A stale running import is cleared only when realm-reader starts

## What

`failStaleRunningImports` runs in the realm-reader boot path. The server never calls it. If the reader dies and the server keeps running, the latest import can stay `running`. The UI keeps showing a sync in progress. Analytics stops waiting after ten minutes but does not mark the row failed.

## Why

The helper’s own comment says the reader is the only writer, so failing every `running` row on reader start is safe. That does not cover a dead reader with a live server.

## How to improve

On server boot, or from the SSE poll, fail `running` imports older than the stale threshold. Surface “realm-reader down” instead of an endless sync.

## Potential gain

The live-sync indicator matches reality after a reader crash, and analytics scheduling is not stuck on a row that will never finish.

## Evidence

- `packages/db/src/failStaleRunningImports.ts` (lines 5–10): documented as realm-reader start only.
- `apps/realm-reader/src/index.ts` calls it on boot.
- `apps/server/src/index.ts` `shutdown` clears a stuck pause and does not fail stale imports. `isStaleRunning` in `apps/server/src/analytics/pipeline.ts` only ends the wait.

## Status

Fixed. `packages/db/src/failStaleRunningImports.ts` exports `STALE_RUNNING_MS` (10 min) and `failStaleRunningImportsOlderThan` (age-gated; the reader's fail-all-at-start is unchanged). The server runs it through `apps/server/src/staleImportSweep.ts`, called from the `startPollLoop` tick in `apps/server/src/sse.ts` (first tick at boot, then at most once a minute), so both server entry points are covered. Tests: `packages/db/src/failStaleRunningImports.test.ts`, `apps/server/src/staleImportSweep.test.ts`.
