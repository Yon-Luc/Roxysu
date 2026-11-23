---
id: F3-002
feature: live-sync
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# Rows committed by a cycle that then fails are never announced to analytics

## What

A cycle claims an import, streams batches with autocommit, then dies before
`commitImport` (busy timeout, Realm read error, quit, migration race). The rows stay in
the local mirror by design. The next successful cycle reports only its own
`changed*Ids`, so the dead cycle's rows are never in a delta.

`score.imported` does not fire either, because it needs `max(played_at)` to move. For rows
the next incremental cannot re-read - catch-up/heal rows such as an old legacy score or a
beatmap with a null `LastLocalUpdate` - nothing ever schedules `score_metrics`, sessions,
mastery, dan variants or pattern analysis until the app restarts. `importNeedsForcedFull`
requires `maxPlayedAt > watermark`, which is false for an old-date score.

## Why

The "what is new" signal lives only in the committed import row
(`imports.changedScoreIds`). Streamed batches leave no pending-row marker, and catch-up is
id-set based ("row exists -> nothing to do"), so it cannot distinguish an analysed row
from an unannounced one.

## How to improve

Persist in-flight changed ids before the streaming phase, or mark rows with a nullable
`imported_announced_at` cleared by the analytics delta.

The smallest concrete fix: on `failImport`, copy the already-streamed changed ids into a
pending-delta row in `settings`, and have the next `commitImport` merge it into
`changedScoreIds`. `failImport` today receives only the error, so the delta writer result
has to be threaded into it from the three catch blocks.

## Evidence

- `apps/realm-reader/src/sync.ts:565-570`, `:717-722`, `:783-788` - fail path keeps rows, drops ids
- `apps/realm-reader/src/importJournal.ts:217-223` - ids written only on success
- `apps/server/src/sse.ts:112-130` - only a success row or a higher `maxPlayedAt` publishes
- `apps/server/src/analytics/pipeline.ts:100-122` - `importNeedsForcedFull`
- `apps/realm-reader/src/reconcileCore.ts:114-130` - catch-up is presence-only

## Notes

F-009 fixed the transaction boundary. This is the notification side of the same
partial-failure window and was not covered by it.
