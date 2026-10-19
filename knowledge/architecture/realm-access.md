---
last_verified: 2026-10
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/backupBeforeWrite.ts
  - apps/realm-reader/schemas/osu-client.schema.json
  - apps/realm-reader/src/export-schema.ts
  - docs/architecture.md
  - README.md
---

# Realm access

## Purpose

Define how Roxysu reads and (rarely) writes osu!lazer's Realm file.

## Business meaning

`client.realm` is osu!'s store — Roxysu treats it as read-only except for manual **collection write-back** and **online score pull**. Schema stability is not guaranteed; extraction code must tolerate lazer changes.

## Business rules

1. Normal operation: read-only extraction into the local mirror.
2. Only exception: collection write-back to `!Roxysu `-prefixed `BeatmapCollection` rows (manual, gated, backed up).
3. Do not use Realm change listeners — poll/watermark extraction instead (lazer may exclusive-lock the file).
4. Every intentional Realm write takes the shared Realm write lock (`apps/server/src/shared/realmWriteLock.ts`) and holds the reference-counted extraction pause; `client.realm` is backed up after a probe connection and before the write connection opens (`apps/realm-reader/src/backupBeforeWrite.ts`).
5. Realm JS open requires an exact schema version match. The bundled pin is `apps/realm-reader/schemas/osu-client.schema.json` (currently **52**). Re-export with `export-schema` when lazer advances; if the file is newer than the pin, extraction sets `sync.schema_outdated` and waits (see live-sync).

## Related knowledge

- [vocabulary.md](../vocabulary.md)
- [business/realm-read-only.md](../business/realm-read-only.md)
- [decisions/poll-not-realm-listeners.md](../decisions/poll-not-realm-listeners.md)
- [features/live-sync/index.md](../features/live-sync/index.md)
