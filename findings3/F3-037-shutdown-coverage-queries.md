---
id: F3-037
feature: cross-cutting
kind: perf
severity: low
confidence: verified
status: proposed
reopens: G4
---

# Shutdown runs full coverage queries on the main thread

## What

Each `stopXBackfill(db)` returns `getXJobState(db)`, which computes coverage with full-table
queries. The shutdown wait loop polls three of these every 50 ms.

On a large library this blocks the event loop while quitting, eating into the 5 s SIGKILL
grace after the 3 s analytics wait - risking the mid-write kill F-059 was meant to prevent.

## Why

The status getters double as coverage calculators. Nothing cheaper exists for the wait loop.

## How to improve

Add cheap status getters that read `job.status` only, and use them in `asyncJobStatuses` and the
stop path. Keep the coverage getters for the UI.

## Evidence

- `apps/server/src/shutdownJobs.ts:41-53`, `:98-103` - poll loop
- `apps/server/src/map-analysis/patternAnalysisJob.ts:155-168` - coverage getter
- `apps/server/src/map-analysis/reworkDanJob.ts:140-151`
- `apps/server/src/mania-rating/job.ts:230-247`
- `apps/desktop/main.js:458` - the SIGKILL deadline
