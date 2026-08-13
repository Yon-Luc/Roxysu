---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/syncCollections.ts
  - apps/realm-reader/src/syncCollections.ts
---

# Flow: Collection write-back to lazer

## User intent

Push Roxysu collections into osu!lazer for in-game use.

## Flow

```
POST /api/collections/sync-lazer
    ↓
resolve each collection query → MD5 hashes
    ↓
pause Realm extraction (sync.realm_reader_paused)
    ↓
backup client.realm + lock/schema gates
    ↓
realm.write() only !Roxysu collections
    ↓
persist lazer_collection_id; clear pause
```

## Business guarantee

Non-`!Roxysu` lazer collections are untouched; a backup exists before write; write-back fails safely if lazer is open.

## Implementation references

- `apps/server/src/shared/syncCollections.ts`
- `apps/realm-reader/src/syncCollections.ts`
- `packages/collection-sync`, `packages/realm-backup`
