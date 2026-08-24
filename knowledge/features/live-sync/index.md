---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/sync.ts
  - apps/server/src/sse.ts
---

# Realm extraction

## Purpose

Continuously extract Realm beatmaps and scores into the local mirror; surface Synced / Syncing / Paused / Failed in the UI over SSE. Optional pause when the browser tab is unfocused.

**In UI:** "Live sync" — canonical term: **Realm extraction**.

## Business rules

1. Prefer watermark incremental extraction; reconcile periodically; full remap only on first import / `REALM_FULL_SYNC=1`.
2. Soft-deleted Realm objects upsert with `delete_pending = true`.
3. Stuck pause cleared on server/reader startup (`clearStuckRealmReaderPause`).
4. Collection write-back sets `sync.realm_reader_paused` for the duration of the write.

## Important symbols

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/sync.ts`
- `apps/server/src/sse.ts` — poll `imports` + `MAX(played_at)` (no `COUNT(*)`); SSE `: ping` heartbeat ~20s

## Dependencies

- [architecture/local-mirror.md](../../architecture/local-mirror.md)
- [architecture/data-ownership.md](../../architecture/data-ownership.md)
- `packages/osu-paths`

## Depended on by

- Nearly all practice features (scores/beatmaps source of truth in local mirror)
- `features/smart-collections/` — pause during collection write-back

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Realm extraction, Import
- [flows/realm-extraction-to-ui.md](../../flows/realm-extraction-to-ui.md)
- [business/realm-read-only.md](../../business/realm-read-only.md)

**In code:** feature folder `live-sync/`, module `sync.ts`.
