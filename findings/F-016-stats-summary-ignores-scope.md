---
id: F-016
feature: stats
kind: logic-gap
severity: medium
confidence: verified
status: fixed
---

# Stats summary counts sessions and PBs outside the score scope

## What

`getPlayerStats` filters mania rows with `scoreScopeFilter` (username and gamemode). `getSessionStats` loads every session and counts every `score_metrics.is_pb` row. It does not join scores, and it does not apply `delete_pending`, username, or gamemode.

## Why

Session detail already scopes PB counts through `countSessionPbs`. The summary path does not. With a username or gamemode filter, the header can include other accounts, rulesets, or deleted scores while charts use the filter.

## How to improve

Count sessions and PBs with the same username, gamemode, and `delete_pending` conditions as the rest of the page. `countSessionPbs` is the pattern to reuse.

## Potential gain

The Stats header matches the charts and skill bands for the active Practice score scope.

## Evidence

- `apps/server/src/analytics/playerStats.ts` `scoreScopeFilter` (lines 50–65) versus `getSessionStats` (lines 309–352), which selects all `sessions` and `eq(scoreMetrics.isPb, true)` with no join.
- `apps/server/src/analytics/session.ts` `countSessionPbs` (about lines 673–690) applies the scope.

## Status

Fixed. `getSessionStats` in `apps/server/src/analytics/playerStats.ts` now groups `score_metrics` joined to `scores` with the same `delete_pending`, username, and gamemode scope as the rest of the Stats page (resolved once per request by `scoreScopeFilter`). Only sessions containing at least one scoped play are counted; a session's play count in the averages and the "longest" entry is its scoped plays, not the stored `sessions.score_count`; `pbCount` counts scoped `is_pb` rows (including PBs with no session). Session start/end times are still the stored values. Cost: one grouped join over `score_metrics` (about 170 ms at 200k scores), paid only on a Stats cache miss. Covered by `apps/server/src/analytics/playerStats.test.ts` (header counts vs a plain-JS reference for three scopes, and an empty scope).
