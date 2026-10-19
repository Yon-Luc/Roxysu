---
id: F-017
feature: sunny-dan-recommendations
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Dan-variant backfill blocks the server with no memory guard

## What

Sunny, Daniel, and rework backfills pause under memory pressure and yield between batches. The dan-variant job calls `backfillDanVariantsSync` from a timer. Each combo does `readFileSync` and runs the estimators on the server thread. There is no heap check and no yield inside the combo.

## Why

After import, or when boot enqueues a full scan, this is the same class of chart work as the other jobs, without the pause those jobs document. The event loop that serves the UI shares that thread.

## How to improve

Use the same `isMemoryPressure` / `shouldContinue` gate and per-combo yield as the Sunny and rework jobs.

## Potential gain

Variant catch-up no longer stalls API responses on a large modded library.

## Evidence

- `apps/server/src/map-analysis/danVariantJob.ts` `runBatch` (lines 125–143): synchronous `backfillDanVariantsSync`, then `setTimeout` only between batches.
- `apps/server/src/map-analysis/computeDanVariants.ts` `computeOneComboSync` reads the `.osu` file and runs the estimator inline.

## Status

Fixed. The dan variant job now follows the Sunny/rework pattern: new `paused` status with `isMemoryPressure` guard and 5 s poll, async `backfillDanVariants` (`computeDanVariants.ts`) that checks `shouldContinue` before each combo and yields per combo via `yieldForBackfill`. The job drops only processed combos on an early stop, and also no longer drops the wrong queue keys when earlier combos were already fresh. Covered by `danVariantJob.test.ts`.
