---
id: F-045
feature: roxysu-play
kind: perf
severity: medium
confidence: verified
status: fixed
---

# Song select filters Realm collections with one lookup per beatmap

## What

For a Realm collection, `resolveBeatmapIds` loads every beatmap id in the collection, then calls `getById` per id to keep mania maps of the current key count. Search and count both use this path.

## Why

The SQL that loads the ids already joins `beatmaps`. The key-count and ruleset filters are applied in process afterward. A collection of thousands of maps does thousands of lookups and can also build a large `IN` list downstream.

## How to improve

Add `rulesetShortName` and `circleSize` to the `getRealmBeatmapIds` query and return only the rows song select can play.

## Potential gain

Song select stays responsive on large Realm collections.

## Evidence

- `apps/play/src/songselect/SongSelect.ts` `resolveBeatmapIds` (lines 79–91): filter with `this.beatmaps.getById`.
- `apps/play/src/database/CollectionRepository.ts` `getRealmBeatmapIds` (lines 51–58): join already has `beatmaps`, selects only `id`.

## Status

Fixed. `CollectionRepository.getRealmBeatmapIds(collectionId, { ruleset, keys })` now applies the ruleset short name and `circle_size` in the same join query; `RoxysuCatalog.getRealmBeatmapIds` forwards the filter and `SongSelect.resolveBeatmapIds` passes `{ ruleset: "mania", keys }`, so the per-id `getById` calls are gone. Test: `apps/play/src/songselect/SongSelect.test.ts` (mixed rulesets and key counts, asserts zero `getById` calls). Knowledge: `knowledge/features/roxysu-play/index.md` rule 6.
