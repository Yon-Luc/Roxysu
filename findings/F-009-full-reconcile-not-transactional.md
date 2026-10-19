---
id: F-009
feature: live-sync
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Full and reconcile extraction commit outside one import transaction

## What

Incremental sync wraps upserts and `finishImport` in `withTransaction`. Full sync and reconcile stream batches with autocommit, then call `finishImport` once at the end. A crash mid-cycle leaves a failed import journal and a mirror that mixes old and new rows.

## Why

Only `runIncrementalSync` holds the transaction across the write and the journal finalize. `runFullSync` calls `streamMappedUpsert` on the bare database handle.

## How to improve

Wrap each full or reconcile cycle’s upserts and `finishImport` in one deferred transaction, or mark a partial generation that forces reconcile on the next start before analytics treats the mirror as complete.

## Potential gain

A killed bootstrap does not leave an ambiguous mirror that analytics then treats as finished data.

## Evidence

- `apps/realm-reader/src/sync.ts` `runIncrementalSync` (about lines 1352–1409) uses `withTransaction`.
- `runFullSync` (about lines 785–882) calls `streamMappedUpsert` and `finishImport` without that wrapper.

## Status

Fixed. Evaluated one transaction around the streaming extraction and rejected it (holds the shared WAL write lock for the whole library). Chosen: batches keep autocommitting; the import stays `running` until a short immediate commit phase (`commitImport` in `apps/realm-reader/src/importJournal.ts`) that holds orphan deletes, the stall counter, the replay-backfill one-shot flag, watermarks and the `success` flip together. `getWatermarks` no longer derives a cursor from table `MAX()` when no successful import exists, so a bootstrap killed mid-run is re-run as a full extraction instead of an incremental. `runFullSync`, `runReconcileSync` and `runIncrementalSync` (`sync.ts`) use it. Tests: `importJournal.test.ts`. Decision: `knowledge/decisions/extraction-commit-phase.md`.
