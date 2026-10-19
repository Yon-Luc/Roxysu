---
id: F-010
feature: live-sync
kind: logic-gap
severity: medium
confidence: verified
---

# Soft-delete and hidden flags heal only when counts differ

## What

Incremental and reconcile remap soft-deleted scores, soft-deleted sets, and hidden beatmaps only when the Realm count of those objects differs from the SQLite count. If one row is restored and another is deleted, the counts can match while the wrong rows stay flagged.

## Why

The gates compare lengths (`realmSoftScores.length !== sqliteSoftScores` and the set and hidden analogues). They do not compare ids. Practice library and query language exclude rows using those flags.

## How to improve

Hash the sorted ids, or remap whenever the id set differs, not only when the counts differ. A periodic sample is enough if a full remap every poll is too heavy.

## Potential gain

Undo/redo of deletes and hides in lazer shows up in the practice library without waiting for a full remap.

## Evidence

- `apps/realm-reader/src/sync.ts` (about lines 1038–1069): three count comparisons before mapping `DeletePending` and `Hidden` objects.
