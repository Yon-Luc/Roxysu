---
id: F-009
feature: live-sync
kind: correctness
severity: medium
confidence: verified
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
