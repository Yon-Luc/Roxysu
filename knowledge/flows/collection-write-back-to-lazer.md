---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/syncCollections.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/backupBeforeWrite.ts
  - apps/realm-reader/src/syncCollections.ts
---

# Flow: Collection write-back to lazer

## User intent

Push Roxysu collections into osu!lazer for in-game use.

## Flow

```
POST /api/collections/sync-lazer
    ↓
resolve each smart-collection query → MD5 hashes
hub-added rows → MD5s of listed beatmap online ids (or every difficulty of each set when that list is empty)
    ↓
take Realm write lock (409 in_flight if another Realm write runs)
    ↓
pause Realm extraction (sync.realm_reader_paused, reference-counted)
    ↓
probe connection (lazer closed, schema) → backup client.realm → open for write
    ↓
realm.write() only !Roxysu collections
    ↓
persist lazer_collection_id; release pause and lock
```

## Business guarantee

Non-`!Roxysu` lazer collections are untouched; a backup exists before write; write-back fails safely if lazer is open.

## Implementation references

- `apps/server/src/shared/syncCollections.ts`
- `apps/server/src/shared/realmWriteLock.ts`
- `apps/realm-reader/src/syncCollections.ts`
- `packages/collection-sync`, `packages/realm-backup`
