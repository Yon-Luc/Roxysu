---
id: F3-007
feature: analytics
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# One session reports two different play counts

## What

`sessions.score_count` is a stored snapshot written only when the session engine rebuilds
it. The session list, the detail header and the dashboard's last-session card read that
number. The score list, `pbCount` and the Stats session averages count `score_metrics` rows.

Measured in the local mirror: session `172616` reads 33 plays in the list and header, and
has 10 scores with 10 metric rows. `scores_deleted` is 0 in every recent import, and the
last import carries `changed_score_ids: []`, so the pipeline skips all engines and nothing
ever heals it.

## Why

`reconcileBuckets` sets `scoreCount: bucket.scoreIds.length` at rebuild time. Hard deletes
elsewhere (`reconcileDeletes` deletes `score_metrics` then `scores`) never decrement it.
`runAnalyticsPipeline`'s "delta empty - skip engines" branch means a session repair only
happens when some later import carries changed ids.

## How to improve

Stop trusting the column for display. `listSessions` and `practiceSnapshot` should read
`COUNT(score_metrics)` per session, which is indexed by `session_id`.

If the join is too expensive for the list, add a cheap repair to the pipeline's
empty-delta branch: compare `sessions.score_count` against a grouped metric count and
rewrite the mismatches. Either way, pick one source of truth.

## Evidence

- `apps/server/src/analytics/session.ts:272-302` - snapshot write
- `apps/server/src/analytics/session.ts:674-681` - snapshot read
- `apps/server/src/analytics/playerStats.ts:673-701` - metrics-based counts
- `apps/server/src/analytics/practiceSnapshot.ts:90` - reads the snapshot
- `apps/realm-reader/src/reconcileCore.ts:127-130` - deletes metrics without decrementing
- `apps/server/src/analytics/pipeline.ts:289-290` - empty-delta skip

## Status

Fixed 2026-11-23. `healSessionScoreCounts` rewrites `sessions.score_count` from `COUNT(score_metrics)` where they disagree. The analytics pipeline calls it on every run, including an empty delta that skips the session engine. Test: `healSessionScoreCounts` in `session.test.ts`.
