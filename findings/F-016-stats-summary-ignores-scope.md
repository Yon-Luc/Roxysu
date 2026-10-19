---
id: F-016
feature: stats
kind: logic-gap
severity: medium
confidence: verified
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
