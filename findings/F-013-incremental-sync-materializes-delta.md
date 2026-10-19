---
id: F-013
feature: live-sync
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Incremental sync loads the whole watermark delta into memory

## What

After a long pause, incremental sync walks every beatmap with `LastLocalUpdate` past the watermark and every score with `Date` past the watermark, pushing mapped rows into arrays before any upsert. Full sync streams with `streamMappedUpsert`.

## Why

The incremental path hydrates beatmap and set dependencies for scores in memory first. A mass import in lazer, or a long AFK period, becomes one large allocation in the realm-reader process.

## How to improve

Stream beatmaps and scores in bounded batches the way full sync does, and hydrate missing sets for each batch only.

## Potential gain

Realm-reader memory stays flat after a large lazer import instead of scaling with the whole delta.

## Evidence

- `apps/realm-reader/src/sync.ts` `runIncrementalSync` (about lines 1189–1211): `beatmapRows.push` and `scoreRows.push` over the full filtered Realm results.

## Status

Fixed. `streamIncrementalDelta` / `DeltaWriter` (`apps/realm-reader/src/deltaCore.ts`) stream the beatmap and score deltas in 500-row batches, hydrating rulesets, sets and missing beatmaps per batch; changed ids are capped at the analytics threshold (null beyond it). The watermark still lands only with the commit phase and the F-010 flag healing runs after the delta. Judgement call: a score batch refetches a referenced beatmap from Realm only when it is missing from the local mirror (previously every non-delta beatmap was refetched). Tests: `deltaCore.test.ts` (batch boundaries 500/501/1201, per-batch hydration, watermark coverage).
