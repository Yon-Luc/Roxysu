---
cand: G4
reopens: F-059
feature: cross-cutting
kind: perf
severity: low
confidence: verified
status: proposed
---

# Shutdown polls full coverage queries on the main thread

## Problem

`shutdownBackgroundWork` stops the jobs, then polls `asyncJobStatuses` every 50 ms until they leave `running` / `stopping`, or the 3 s deadline hits. The poll is `shutdownJobs.ts`, not `apps/desktop/main.js:458`. That line is `CHILD_STOP_GRACE_MS`.

The three polled getters are `getManiaRatingJobState`, `getReworkDanJobState`, and `getPatternAnalysisJobState`. Rework and pattern always run full-table coverage SQL plus a pending count. Desktop's server uses sync `better-sqlite3`, so each poll blocks the event loop. On a large library that eats the 3 s analytics budget and the 5 s SIGKILL grace F-059 added so quit would not kill a mid-write.

The loop does not run when every polled job is already idle. Mania skips the query when status is `running` or `stopping` and `coverageSnapshot` is set. Sunny and daniel stops are not in the 50 ms list.

`stopReworkDanBackfill` and `stopPatternAnalysisBackfill` also call the full getter once. That single call is fine. The poll is not.

## Potential solution

Status for the wait loop is the in-memory `job.status` only. Coverage stays on the HTTP job-state routes, where a slow query does not sit on the quit path.

```ts
export function getReworkDanJobStatus(): JobStatus["status"] {
  return job.status;
}
```

Same for pattern analysis and mania rating. `defaultDeps` becomes:

```ts
asyncJobStatuses: [
  () => getManiaRatingJobStatus(),
  () => getReworkDanJobStatus(),
  () => getPatternAnalysisJobStatus(),
],
```

Do not pass `db` into these. They must not be able to query.

Leave `getXJobState` for the settings and job endpoints. Leave the one coverage read inside `stopXBackfill` if a caller displays that return value. If the stop function's return value is only logged, return `job.status` there too.

## Do not

- Do not lengthen the 3 s deadline to hide the cost. The deadline exists so quit can reach `closeDb`.
- Do not drop the poll. A job still marked `running` must be waited on. The read has to be cheap.

## Touch

- `apps/server/src/shutdownJobs.ts` — `asyncJobStatuses`
- `apps/server/src/map-analysis/reworkDanJob.ts`
- `apps/server/src/map-analysis/patternAnalysisJob.ts`
- `apps/server/src/mania-rating/job.ts`

## Tests

`shutdownJobs` tests that inject `deps` already avoid the real getters. Add one assertion that `defaultDeps(db).asyncJobStatuses` does not call a coverage function. Easiest: export the status readers and assert each returns `job.status` with a db double whose `prepare` throws. If the status reader queries, the test fails.
