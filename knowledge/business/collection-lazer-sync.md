---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - packages/collection-sync/src/index.ts
  - apps/realm-reader/src/syncCollections.ts
  - packages/realm-backup
---

# Collection lazer sync

## Business rules

1. Manual only — never background-write Realm.
2. Pause realm-reader (`sync.realm_reader_paused`) during write.
3. Abort if lazer exclusive lock held.
4. Schema version guard before write.
5. Backup `client.realm` (keep last 5).
6. Only names starting with `!Roxysu ` (`LAZER_COLLECTION_PREFIX`).
7. Single `realm.write()` transaction.
8. Managed collections missing from payload are deleted.
9. Hub-synced collections may use ids `HUB_SYNC_ID_BASE + hubId`.

**Status:** verified
