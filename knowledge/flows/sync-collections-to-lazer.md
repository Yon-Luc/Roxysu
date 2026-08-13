---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/syncCollections.ts
  - apps/realm-reader/src/syncCollections.ts
---

# Flow: Sync collections to lazer

## User intent

Push Roxysu smart collections into osu!lazer for in-game use.

## Flow

```
POST /api/collections/sync-lazer
    ↓
resolve each collection query → MD5 hashes
    ↓
set realm-reader pause
    ↓
backup client.realm + lock/schema gates
    ↓
realm.write() only !Roxysu collections
    ↓
store lazer_collection_id; clear pause
```

## Business guarantee

Non-`!Roxysu` lazer collections are untouched; a backup exists before write; sync fails safely if lazer is open.

## Implementation references

- `apps/server/src/shared/syncCollections.ts`
- `apps/realm-reader/src/syncCollections.ts`
- `packages/collection-sync`, `packages/realm-backup`
