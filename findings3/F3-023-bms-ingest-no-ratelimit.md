---
id: F3-023
feature: bms
kind: security
severity: medium
confidence: verified
status: proposed
---

# BMS ingest has no rate limit, and dedupe is keyed on a client-chosen id

## What

`POST /api/bms/scores/batch` is authenticated but unthrottled. Uniqueness is
`(user, installationId, localScoreId)`, and both values come from the client.

Rotating `installationId` defeats the duplicate check and the "previously rejected" memo, so
one account can insert unbounded rows into `bms_scores` and flood the public feed and
leaderboards.

## Why

No `allowRateLimit` call exists on this route, unlike `collection-write` at 5/min.
`ingestBmsBatch` only caps a single batch at 50. The only anti-duplicate keys are
`findScore` and the `bmsScoreSubmissions` lookup, both scoped to the supplied installation id.

## How to improve

Add `allowRateLimit('bms-ingest:${user.sub}', ...)` and a per-IP bucket to the handler, plus a
per-user daily row cap.

Dedupe additionally on `(userId, chartMd5, achievedAt, exScore)` so a fresh installation id
cannot re-insert the same play.

## Evidence

- `apps/hub/src/routes/bms.ts:103-125` - handler with no limiter
- `apps/hub/src/routes/collections.ts:39`, `:374` - the limiter pattern used elsewhere
- `apps/hub/src/services/bms.ts:176-203` - dedupe scoped to installation id
- `apps/hub/src/services/bms.ts:310-315` - batch cap only
- `apps/hub/src/services/bmsCommunity.ts:220-267` - public reads of those rows
