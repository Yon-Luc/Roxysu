---
id: F3-001
feature: live-sync
kind: correctness
severity: high
confidence: verified
status: fixed
reopens: F-002, A1
---

# Score write-back inserts its own `success` import row

## What

`runOnlineScoreWrite` and `runScoreTransferWrite` end by inserting a fresh `imports` row
with `status: "success"` and an auto-increment id higher than any cycle still streaming.

Two things follow.

`latestImport()` orders by `id desc limit 1`, so the analytics gate sees that success row
and lets the pipeline run while a lower-id import is still `running`. That is the F-002
scenario: a rebuild over a partially extracted local mirror.

`getWatermarks()` also reads only the highest-id success row. The synthetic row copies the
previous watermarks, or `null` when no cycle has committed yet. A `null` cursor sends
`getWatermarks` into `fallbackWatermarksFromTables()` -> `MAX(played_at)` over a partially
extracted mirror. If a bootstrap failed, `hasSuccessfulImport` is now true via the
synthetic row, so the next cycle is incremental with its cursor at the newest partially
imported score and older history is not imported until a reconcile notices a count gap.

## Why

Two writers create import journal entries outside `commitImport`. The gate and the cursor
both assume "newest id wins" and that `success` implies a finished cycle.

## How to improve

Route both writers through `importJournal.ts`. Either call `claimImport`/`commitImport`
around their mirror writes (they already have the changed score ids), or add
`recordWriteBackImport()` that reuses the current latest success id instead of inserting a
row.

Independently, make `latestImport` consider any `running` row, not just the highest id:
select where `status = 'running'` and wait on that regardless of a higher success id. The
same correction belongs in the SSE poll that publishes import state.

## Evidence

- `apps/realm-reader/src/writeOnlineScores.ts:279-307` - `db.insert(imports).values({ status: "success" ... })`, watermarks copied from the last success or `null`
- `apps/realm-reader/src/writeScoreTransfer.ts:303-331` - same shape
- `apps/server/src/analytics/pipeline.ts:53-66` - `latestImport` is `orderBy(desc(imports.id)).limit(1)`
- `apps/server/src/sse.ts:106-122` - import state published from the same single row
- `knowledge/decisions/extraction-commit-phase.md:27` - "Never write `success` ... outside `commitImport`"

## Notes

This is a decision violation, not a style preference. The decision explicitly rejects a
"partial extraction" flag on the grounds that `imports.status` already carries the meaning;
a second writer that fabricates a success row breaks that contract.

## Status

Fixed 2026-11-23. The writers no longer claim to be an extraction cycle:

- `imports.kind` gained `writeback` (TS enum only; the column is plain TEXT, so no migration).
  `runOnlineScoreWrite` and `runScoreTransferWrite` use it.
- `extractionImportOnly` (`packages/db/src/importKind.ts`) is the single predicate every reader
  that means "Realm extraction state" applies: `hasSuccessfulImport`, `getWatermarks`,
  `latestImport`, `importNeedsForcedFull`, the SSE sync state, the dashboard card and
  `GET /system`.
- `latestImport` now returns any `running` row first, so a live cycle blocks the pipeline even
  when a higher-id write-back row landed on top of it. That closes the F-002 bypass rather than
  only narrowing it.
- `loadAnalyticsDelta` deliberately still accepts a write-back row: it is the mechanism by
  which analytics hears about the scores a write-back touched.

Both writers also now record `changedBeatmapIds`. They only set `changedScoreIds`, so
`parseIdJson(null)` on the beatmap side made `needsFullRebuild` return true — every write-back
that reached the pipeline forced a full rebuild.

Tests: `importJournal.test.ts` "write-back import rows" (3) and `pipeline.rebuild.test.ts`
"write-back import rows" (3). Server 1023 pass, realm-reader 51 pass.

Not covered: routing the writers through `commitImport` itself. The journal row is still
created outside it, but it no longer asserts anything the gate trusts, which is what the
decision requires. A follow-up could delete the synthetic row entirely and have the writers
publish the delta through a settings row.
