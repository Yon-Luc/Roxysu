---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/syncCollections.ts
  - apps/realm-reader/src/syncCollections.ts
  - packages/collection-sync/src/index.ts
---

# Smart collections & lazer sync

## Purpose

Collections are saved **query strings**, not static lists. Optional manual sync pushes matches into osu!lazer as `!Roxysu {name}` collections.

## Business meaning

Dynamic practice playlists that stay current as the library grows; optional bridge into lazer’s collection UI.

## Business rules

1. A collection stores query text; matches are computed, not stored as the primary definition.
2. Lazer sync is **manual only** (`POST /api/collections/sync-lazer`).
3. Only collections named with prefix `!Roxysu ` are managed in Realm.
4. Managed lazer collections absent from the sync payload are **deleted**.
5. Sync requires: pause realm-reader, lock probe (lazer closed), schema guard, backup (keep last 5), single `realm.write()`.

## Security rules

Local product API has no auth. Collection sync is still gated by process-safety checks (not user identity):

1. Sync aborts if lazer holds an exclusive lock (game open).
   **Enforced by:** collection sync lock probe — status: verified
   **Unauthorized result:** sync fails; Realm not written

2. Only `!Roxysu `-prefixed BeatmapCollection rows may be created/updated/deleted.
   **Enforced by:** `packages/collection-sync` prefix helpers + realm-reader sync — status: verified
   **Unauthorized result:** non-prefixed collections untouched

## Important symbols

- `apps/server/src/routes/collections.ts`
- `apps/server/src/shared/syncCollections.ts`
- `apps/realm-reader/src/syncCollections.ts`
- `packages/collection-sync/src/index.ts` — `LAZER_COLLECTION_PREFIX`, `HUB_SYNC_ID_BASE`

## Dependencies

- `features/practice-library/` — query execution
- `features/live-sync/` — pause during write-back
- `packages/realm-backup`

## Depended on by

- `features/hub/` — hub collections can sync with synthetic ids

## Related knowledge

- [business/collection-lazer-sync.md](../../business/collection-lazer-sync.md)
- [flows/create-collection.md](../../flows/create-collection.md)
- [flows/sync-collections-to-lazer.md](../../flows/sync-collections-to-lazer.md)
