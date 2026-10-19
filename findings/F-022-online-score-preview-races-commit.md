---
id: F-022
feature: online-score-pull
kind: correctness
severity: medium
confidence: verified
---

# Online score preview can replace the rows a commit is writing

## What

Preview deletes every `online_score_candidates` row, then inserts the new set. Commit reads the table once, writes Realm from that snapshot, and on success deletes every candidate again. Preview is not blocked while `writeInFlight` is set.

## Why

Two tabs, or a preview that finishes while commit is in Realm, can commit a snapshot the UI no longer shows, or wipe a newer preview when the commit’s final delete runs.

## How to improve

Reject preview while a commit is in flight. Stamp the candidate set with a session id and delete only that id on success.

## Potential gain

The scores written to lazer are the scores the user just confirmed.

## Evidence

- `apps/server/src/online-scores/pull.ts` (lines 338–342): `delete(onlineScoreCandidates)` then insert.
- `runCommit` (about lines 425–471): `select().from(onlineScoreCandidates)`, then `delete(onlineScoreCandidates)` on success, with no check that the set is unchanged.
