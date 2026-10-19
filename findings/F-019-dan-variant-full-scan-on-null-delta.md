---
id: F-019
feature: sunny-dan-recommendations
kind: perf
severity: medium
confidence: verified
---

# A null score delta enqueues every mania mod combo

## What

When `imports.changed_score_ids` is null, `enqueueNewImports` calls `collectDanVariantCombos` with no score-id filter. That query reads every non-deleted mania score. Boot already runs `enqueueFullScan`. A full extraction therefore scans the library again and queues every distinct mod combo.

## Why

Null id lists mean “bootstrap or large sync”, not “nothing changed”. The job treats null as “all scores”.

## How to improve

If a full scan already ran for this library generation, ignore a null delta. Otherwise persist a watermark so the full scan happens once.

## Potential gain

The post-full-sync pipeline does not repeat the boot scan or grow a queue of every modded score.

## Evidence

- `apps/server/src/map-analysis/danVariantJob.ts` (lines 104–112): `changedScoreIds == null` becomes an unrestricted `collectDanVariantCombos` call.
- `apps/server/src/map-analysis/computeDanVariants.ts` (lines 68–79): unrestricted query selects every mania score’s beatmap id and mods.
