---
id: F-059
feature: cross-cutting
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Shutdown closes the database while background work can still be writing

## What

`shutdown` in both server entries unsubscribes analytics, stops the dan-variant timer, stops BMS sync, and stops the tosu adapter. It does not wait for an in-flight `runAnalyticsPipeline`. It never calls `stopManiaRatingBackfill`. It then `closeDb` and `process.exit(0)`.

## Why

`stopAnalytics` only drops the event subscription. A pipeline that already started keeps writing. Rating Lab’s backfill is a separate job with its own stop function, used by `POST /job/stop` and not by process shutdown. Closing SQLite under those writers is the dual-process bus failing at the worst time: SIGTERM from desktop quit or a dev restart.

## How to improve

Abort or await the analytics run, call `stopManiaRatingBackfill`, and only then `closeDb`.

## Potential gain

Restarts do not close the mirror mid-write, and Rating Lab calculators do not outlive the server.

## Evidence

- `apps/server/src/index.ts` (lines 54–69) and `apps/server/src/index.node.ts` (lines 75–93): stop list, then `closeDb`, then `exit`. No mania-rating stop.
- `apps/server/src/analytics/pipeline.ts` `startAnalyticsPipeline` returns an unsubscribe function.
- `apps/server/src/mania-rating/job.ts` `stopManiaRatingBackfill` is only referenced from the rating-lab route.

## Status

Fixed. `shutdownAnalyticsPipeline()` (`apps/server/src/analytics/pipeline.ts`) clears the debounce and boot timers, refuses new runs, makes the import wait loop exit, and awaits the in-flight run (3 s bound). New `apps/server/src/shutdownJobs.ts:shutdownBackgroundWork()` also requests stops for the dan-variant, sunny/daniel/rework dan, pattern-analysis, mania-rating and mirror batch jobs and waits (bounded) for the jobs whose batches await. Both `src/index.ts` and `src/index.node.ts` call it after `app.stop` and before `closeDb`. Tests: `apps/server/src/analytics/pipeline.shutdown.test.ts`, `apps/server/src/shutdownJobs.test.ts`.
