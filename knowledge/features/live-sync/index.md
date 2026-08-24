---
last_verified: 2026-08
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/sync.ts
  - apps/realm-reader/src/syncRealmCollections.ts
  - packages/db/src/failStaleRunningImports.ts
  - apps/server/src/sse.ts
  - apps/server/src/analytics/pipeline.ts
---

# Realm extraction

## Purpose

Continuously extract Realm beatmaps and scores into the local mirror; surface Synced / Syncing / Paused / Failed in the UI over SSE. Optional pause when the browser tab is unfocused.

**In UI:** "Live sync" — canonical term: **Realm extraction**.

## Business rules

1. Prefer watermark incremental extraction; reconcile periodically; full remap only on first import / one-shot `REALM_FULL_SYNC=1` (consumed after the first successful full cycle).
2. Soft-deleted Realm **Score** and **BeatmapSet** objects upsert with `delete_pending = true`. Realm Beatmap has no `DeletePending`; difficulty hide uses `hidden`.
3. Incremental cursor is the last successful import's `watermark_played_at` / `watermark_last_local_update`, not `MAX()` from data tables.
4. Stuck pause cleared on server/reader startup (`clearStuckRealmReaderPause`). Stale `running` imports are marked failed (`failStaleRunningImports`).
5. Collection write-back sets `sync.realm_reader_paused` for the duration of the write.
6. Realm collection extract is isolated from the score/beatmap write; a bad collection cannot fail the import.

## Important symbols

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/sync.ts`
- `apps/realm-reader/src/syncRealmCollections.ts`
- `packages/db/src/failStaleRunningImports.ts`
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
