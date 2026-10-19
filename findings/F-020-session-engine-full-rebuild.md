---
id: F-020
feature: sessions
kind: perf
severity: medium
confidence: verified
---

# Session rebuild falls back to every score

## What

The pipeline passes changed score ids into `runSessionEngine`. `tryAppendSessionDelta` returns null on gaps, ordering problems, or scores that belong before the open session. The fallback loads every scoped score, every session, and every `score_metrics` row.

## Why

The append path is an optimization. The comment in the pipeline still says the session engine “stays full for now”. On a library that plays often, the fast path fails often enough that each sync walks the whole timeline.

## How to improve

Repair the open session and the buckets the new scores touch, and reserve the full rebuild for deletes and watermark resets. On the full path, update `session_id` without selecting every metrics row into memory.

## Potential gain

Shorter analytics runs after a normal import, and less write churn on large libraries.

## Evidence

- `apps/server/src/analytics/pipeline.ts` (about lines 237–247): calls `runSessionEngine` with `scoreIds`, next to the “stays full for now” comment.
- `apps/server/src/analytics/session.ts` (about lines 373–411): delta attempt, then `select().from(sessions)` and `select().from(scoreMetrics)`.
