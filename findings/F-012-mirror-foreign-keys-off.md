---
id: F-012
feature: live-sync
kind: design-gap
severity: medium
confidence: verified
---

# The local mirror does not enforce foreign keys

## What

Both SQLite clients set WAL, `busy_timeout`, and `synchronous = NORMAL`. Neither sets `PRAGMA foreign_keys = ON`. Foreign keys declared on the mirror schema are not enforced. Orphan `score_metrics` or mastery rows are prevented only by delete code remembering to clean them up.

## Why

SQLite leaves foreign keys off unless the connection asks for them. The Hub database turns them on separately. The mirror relies on realm-reader’s delete choreography.

## How to improve

Enable foreign keys after checking delete order, or add explicit cascades where a parent delete should remove derived rows. Audit server paths that delete beatmaps or scores outside realm-reader.

## Potential gain

A server delete that forgets a child table cannot leave derived rows pointing at missing scores.

## Evidence

- `packages/db/src/client.node.ts` `createDb` (about lines 20–25): journal, busy timeout, synchronous. No `foreign_keys` pragma.
- `packages/db/src/client.bun.ts` (about lines 18–23): same pragmas.
- Repository search for `foreign_keys` under `packages/db` returns no matches.
