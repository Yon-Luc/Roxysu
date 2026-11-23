---
id: F3-004
feature: live-sync
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# Orphan deletion is unbounded inside the commit transaction

## What

After a Realm reset (new UUIDs for everything, so the whole mirror becomes orphan) or a
large local deletion, `commitImport` calls `reconcileDeletes`, which reads every
score/beatmap/set id into memory and issues one DELETE per 500-id chunk across up to nine
child tables. All of it runs inside the single `immediate` transaction.

For tens of thousands of orphans this holds the SQLite write lock for seconds to minutes.
The Bun server shares the file and, after `busy_timeout` (30 s), its writes fail with
`SQLITE_BUSY`.

## Why

`reconcileDeletes` is called from `finishCountGapRound` inside `commitImport`'s
transaction, and its own `withBusyRetry` cannot safely retry inside a transaction.

## How to improve

Split it. Compute `orphanScoreIds`/`orphanBeatmapIds`/`orphanSetIds` during the streaming
phase - they are pure set differences already available there - and delete them in bounded
autocommit transactions before the commit. The commit transaction then only records
`deleted*Ids`. Because those ids already feed `changed*Ids`, a pre-generated id list keeps
that property without holding the lock.

## Evidence

- `apps/realm-reader/src/reconcileCore.ts:120-124`, `:141-191`, `:209-214`
- `apps/realm-reader/src/importJournal.ts:236-254` - delete inside the commit transaction
- `packages/db/src/client.node.ts:21`, `:36-39` - `busy_timeout`
- `knowledge/decisions/extraction-commit-phase.md:28` - "Keep the commit phase short"

## Notes

F-001 and F-009 moved deletion into the commit for correctness. The unbounded cost of
doing so was not assessed at the time.
