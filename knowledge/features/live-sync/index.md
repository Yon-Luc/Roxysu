---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/sync.ts
  - apps/server/src/sse.ts
---

# Live sync

## Purpose

Continuously mirror `client.realm` into SQLite; surface Synced / Syncing / Paused / Failed in the UI over SSE. Optional pause when the browser tab is unfocused.

## Business rules

1. Prefer watermark incremental sync; reconcile periodically; full remap only on first import / `REALM_FULL_SYNC=1`.
2. Soft-deleted Realm objects upsert with `delete_pending = true`.
3. Stuck pause cleared on server/reader startup (`clearStuckRealmReaderPause`).
4. Collection write-back sets `sync.realm_reader_paused` for the duration of the write.

## Important symbols

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/sync.ts`
- `apps/server/src/sse.ts`

## Dependencies

- `architecture/data-ownership.md`
- `packages/osu-paths`

## Depended on by

- Nearly all practice features (scores/beatmaps SoT mirror)
- `features/smart-collections/` — pause during lazer sync

## Related knowledge

- [flows/realm-sync-to-ui.md](../../flows/realm-sync-to-ui.md)
- [business/realm-read-only.md](../../business/realm-read-only.md)
