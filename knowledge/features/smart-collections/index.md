---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/collections/CollectionsPage.tsx
  - apps/server/public/features/collections/CollectionResultsPage.tsx
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/syncCollections.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/backupBeforeWrite.ts
  - apps/realm-reader/src/syncCollections.ts
  - packages/collection-sync/src/index.ts
---

# Collections & collection write-back

## Purpose

Collections are saved **query strings**, not static lists. Optional manual **collection write-back** pushes matches into osu!lazer as `!Roxysu {name}` collections.

## Business meaning

Dynamic practice playlists that stay current as the practice library grows; optional bridge into lazer's collection UI.

## Business rules

1. A collection stores query text; matches are computed, not stored as the primary definition.
2. Collection write-back is **manual only** (`POST /api/collections/sync-lazer`).
3. Only collections named with prefix `!Roxysu ` are managed in Realm.
4. Managed lazer collections absent from the write-back payload are **deleted**.
5. Write-back requires, in order: the Realm write lock, pause of Realm extraction, a short probe connection (lazer closed, schema guard), backup of `client.realm` (keep last 5) while no Roxysu write connection is open, then the write connection and a single `realm.write()`.
6. MD5 lists for smart-collection queries and hub-added ids are memoized in-process during write-back (LRU 32 / 10 min TTL; hub keys are a hash of the ID list) and cleared on `sync.finished`. Hub-added rows with beatmap online ids write back only those difficulties; an empty id list still writes every difficulty of each beatmapset.
7. Collection write-back, online score pull commit, and score transfer commit share one exclusive Realm write lock. A second Realm write of any kind, not only another write-back, is rejected with HTTP 409 `in_flight`. The extraction pause (`sync.realm_reader_paused`) is reference-counted: set to `"1"` by the first holder and back to `"0"` only when the last holder releases, always in `finally`, so a refused or failed writer never clears another writer's pause.
8. Deleting a smart collection always asks first: the Delete button opens `ConfirmModal` naming the collection. The modal stays busy until the delete request and the collections list refresh finish; an error stays in the modal. Deleting never edits Realm; a copy already written to lazer is removed at the next collection write-back (rule 4).
9. The collection results page keeps the header (name, query, count, export) and the previous page of cards on screen while another page loads, and dims the grid. The skeleton shows only when there is no payload for this collection yet; another collection's payload never stands in.

## Security rules

Client app API has no auth. Collection write-back is still gated by process-safety checks (not user identity):

1. Write-back aborts if lazer holds an exclusive lock (game open).
   **Enforced by:** collection write-back lock probe — status: verified
   **Unauthorized result:** write-back fails; Realm not written

2. Only `!Roxysu `-prefixed BeatmapCollection rows may be created/persisted/deleted.
   **Enforced by:** `packages/collection-sync` prefix helpers + realm-reader write-back — status: verified
   **Unauthorized result:** non-prefixed collections untouched

## Important symbols

- `apps/server/src/routes/collections.ts` — overlapping write-back → 409 `in_flight`
- `apps/server/src/shared/realmWriteLock.ts` — `tryAcquireRealmWriteLock()`, `acquireExtractionPause()`; shared by all three Realm writers
- `apps/realm-reader/src/backupBeforeWrite.ts:backupThenOpenForWrite()` — probe, backup, then open for write; used by all three realm-reader writers
- `apps/server/src/shared/syncCollections.ts` — `invalidateCollectionMd5Cache()`; Node/desktop loads realm-reader via `realmSyncModulePath()` (packaged `syncCollections.js` or monorepo `src/syncCollections.ts`, whichever exists under `ROXYSU_REALM_READER_DIR`)
- `apps/server/src/shared/collectionMatchCache.ts` — yields between collections; re-runs if another event arrives mid-pass
- `apps/realm-reader/src/syncCollections.ts`
- `packages/collection-sync/src/index.ts` — `LAZER_COLLECTION_PREFIX`, `HUB_SYNC_ID_BASE`

## Dependencies

- `features/practice-library/` — query execution
- `features/live-sync/` — pause during write-back
- `packages/realm-backup`

## Depended on by

- `features/hub/` — hub collections can write back with synthetic ids
- `features/online-score-pull/`, `features/score-transfer/` — changing `apps/server/src/shared/realmWriteLock.ts` or the backup-before-open order changes their Realm write behavior too

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Collection, Collection write-back
- [business/collection-lazer-sync.md](../../business/collection-lazer-sync.md)
- [flows/create-collection.md](../../flows/create-collection.md)
- [flows/collection-write-back-to-lazer.md](../../flows/collection-write-back-to-lazer.md)

**In code/UI:** route and modules still named `sync-lazer` / `syncCollections`. Collection write-back sits with the close-lazer warning, not in the page title row.
