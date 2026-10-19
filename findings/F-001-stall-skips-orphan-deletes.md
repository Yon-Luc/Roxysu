---
id: F-001
feature: live-sync
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Reconcile stall skips orphan deletes

## What

When a Realm-to-mirror count gap survives three fruitless reconcile rounds, `runReconcileSync` skips the whole `countsDiffer` branch. That branch is the only place that both catches up missing rows and deletes mirror rows that no longer exist in Realm. After the stall trips, deleted beatmaps and scores stay in the local mirror until some later import moves rows and clears the stall counter.

## Why

The stall breaker in `knowledge/decisions/stream-extraction-stall-breaker.md` is meant to stop repeated full-library catch-up when Realm rows cannot be mirrored. Deletes are inside the same `else`. A library that has both unmirrorable Realm rows and real SQLite orphans never reaches `reconcileDeletes`.

The stall also resets to zero whenever any row moves. A mixed gap (some orphans removed, counts still unequal) can therefore force another full Realm id scan on the next reconcile instead of staying stalled. That scan is `collectRealmIdSets` plus three SQLite id sets, on the order of the whole library, every reconcile interval.

## How to improve

When `stallCount >= CATCHUP_STALL_LIMIT`, still run orphan deletion. Skip only `catchUpMissingFromRealm`. Count a round as fruitless only when the missing-id catch-up changes nothing, so successful deletes do not re-arm an expensive catch-up.

## Potential gain

Beatmaps and scores deleted in osu!lazer disappear from practice search, query results, and analytics. Reconcile stops repeating full-library id diffs on a gap that cannot close.

## Evidence

- `apps/realm-reader/src/sync.ts` `runReconcileSync` (about lines 948–993): the stall branch logs and returns without calling `reconcileDeletes`.
- Stall reset: `writeStallCount(db, movedRows > 0 ? 0 : stallCount + 1)` treats any delete as progress and clears the breaker.
- `collectRealmIdSets` (about lines 368–406) builds the full id sets only on the non-stalled path.

## Status

Fixed. `startCountGapRound` / `finishCountGapRound` (`apps/realm-reader/src/reconcileCore.ts`): a tripped stall breaker skips only `catchUpMissingFromRealm`; Realm id sets are still collected and orphans deleted (inside the commit phase). A round is fruitless only when catch-up moved zero rows; deletes never reset or advance the counter, and the counter resets when the gap closes. Cost while stalled is one Realm id scan per reconcile. Tests: `reconcileCore.test.ts`. Docs: live-sync rule 9, `stream-extraction-stall-breaker.md`.
