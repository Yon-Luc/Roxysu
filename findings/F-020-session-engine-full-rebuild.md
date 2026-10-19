---
id: F-020
feature: sessions
kind: perf
severity: medium
confidence: verified
status: fixed
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

## Status

Fixed. `tryAppendSessionDelta` is replaced by `tryRepairSessionDelta` in `apps/server/src/analytics/session.ts`: it re-buckets only the sessions within one gap of the new scores (plus the open session) together with the new scores, and reconciles them with `reconcileBuckets`, the same routine the full rebuild uses. Intra-batch gaps, scores older than the open session, close/open, merging and extending closed sessions no longer fall back. It still returns null when `sessions.score_count` outside the repaired sessions plus the repaired scores does not equal the in-scope score count (stored sessions not trustworthy), and deletes/watermark resets still force a full rebuild in the pipeline. The full path no longer selects all `score_metrics` rows: prior sessions are read in id chunks, metrics are written with insert-or-ignore plus `UPDATE ... WHERE session_id IS NOT ?`, and orphan sessions are deleted after their metrics are nulled (this also fixes a foreign-key ordering hazard). Full rebuild results are unchanged. The full rebuild still loads every in-scope score id/time (three columns) and every session row, which the gap algorithm needs. Tests: `analytics/session.test.ts` (each formerly-null scenario and 25 random timelines compared to a full rebuild, fallback, full-rebuild orphan handling). `pipeline.ts` only had its comment updated. Knowledge: `features/sessions/` rules 20-21, `business/sessions-gap.md`, `flows/score-indexing-analytics.md`.
