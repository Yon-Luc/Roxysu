---
id: F-004
feature: smart-collections
kind: correctness
severity: high
confidence: verified
---

# Realm writes are not exclusive, and the extraction pause is not counted

## What

Collection write-back, online score commit, and score-transfer commit each have their own in-flight flag. Nothing stops one from running while another has `client.realm` open for write. All three set `SYNC_REALM_READER_PAUSED` to `"1"` and clear it to `"0"` in `finally` with no reference count.

## Why

The pause is one settings row, not a lock. If write-back and a score commit overlap, the first to finish sets the pause back to `"0"` while the other is still mutating Realm. Realm-reader can reconcile against a file that is mid-write. The separate mutexes only prevent two operations of the same kind.

## How to improve

One Realm-mutation lock shared by write-back, online score commit, and score transfer. Hold the extraction pause until the last holder releases it. Return `in_flight` from any of the three routes while that lock is held.

## Potential gain

Collection write-back and score writes cannot interleave. Extraction stays paused for the whole critical section, so reconcile does not mix a half-written Realm into the mirror.

## Evidence

- `apps/server/src/shared/syncCollections.ts` `writeBackInFlight` (lines 327–342) and pause set/clear (lines 413–455).
- `apps/server/src/online-scores/pull.ts` `writeInFlight` (lines 414–421) and pause clear in `finally` (lines 438–473).
- `apps/server/src/score-transfer/transfer.ts` `writeInFlight` (lines 333–338) and the same pause key (lines 361–402).
