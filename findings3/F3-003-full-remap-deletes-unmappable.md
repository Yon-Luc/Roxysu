---
id: F3-003
feature: live-sync
kind: correctness
severity: low
confidence: verified
status: proposed
---

# A full remap deletes unmappable beatmaps, and their user data, that reconcile keeps

## What

`mapBeatmap` returns `null` when the Realm `BeatmapSet` link is gone. `runFullSync` builds
`realmBeatmapIds` only from rows that mapped, so the commit phase deletes every local
beatmap row for such an object - plus its notes, tags, mastery, dan/pattern rows and
`play_sessions` - and nulls `scores.beatmap_id` for its scores.

`runReconcileSync` builds the id set from raw Realm ids (`collectRealmIdSets`), so the same
state is preserved by reconcile. Which rows the practice library keeps therefore depends
on whether the last cycle was full or reconcile, and `REALM_FULL_SYNC=1` silently destroys
user-authored data for maps that were only ever unmirrorable.

## Why

Two different id-set semantics for the orphan check: mapped ids in `runFullSync`, raw ids
in `collectRealmIdSets`.

## How to improve

Make `runFullSync` collect `realmBeatmapIds`/`realmSetIds` from the Realm iterator
independently of `mapBeatmap`'s success, mirroring `collectRealmIdSets`. Add the id before
the null check in the `streamMappedUpsert` callback, so an unmappable row is neither
deleted nor re-written.

## Evidence

- `apps/realm-reader/src/sync.ts:470-489` - ids added only from mapped rows
- `apps/realm-reader/src/sync.ts:183-207` - reconcile's raw-id collection
- `apps/realm-reader/src/map.ts:131-135` - `!set || !setId` -> `null`
- `apps/realm-reader/src/reconcileCore.ts:137-191` - orphan delete
- `apps/realm-reader/src/sync.ts:501-503`, `:518-524` - commit deletes unmapped ids

## Notes

`decisions/stream-extraction-stall-breaker.md` documents unmirrorable rows as a catch-up
cost, not as data a full remap may destroy.
