---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/score-transfer/transfer.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/backupBeforeWrite.ts
  - apps/server/src/score-transfer/format.ts
  - apps/realm-reader/src/writeScoreTransfer.ts
  - apps/realm-reader/src/scoreTransferMatch.ts
  - apps/server/public/features/settings/sections/ScoreTransferSection.tsx
---

# Score transfer

## Purpose

Move local scores between PCs with a file, and add the ones missing from this lazer install so they show in the game.

## Business meaning

A manual, add-only exchange. Export reads the local mirror. The write goes into Realm first; a mirror-only insert would be removed on the next Realm extraction reconcile.

## Business rules

1. The file is `format: "roxysu-scores"`, `version: 1`. Scores only — no replay blobs.
2. Export includes non-deleted scores for the score-username filter, all rulesets. A filter of all includes every non-deleted score. The export is streamed: scores are read in keyset pages (by score id, 1000 rows per page) and each page is encoded before the next is read, so memory is bounded by one page. The streamed bytes equal `JSON.stringify` of the file, so the import path needs no change. A failure mid-stream truncates the download, which import rejects as not a score transfer.
3. A score is already present when its online id is positive and known, its legacy online id is positive and known, or the beatmap, played-at (5 seconds), total score, and ruleset match. Online id `0` is not an identity.
4. A score can be added when its beatmap is installed. A positive beatmap online id with a checksum mismatch still attaches to the current file. An unsubmitted map matches by md5, then hash — never by online id `0`.
5. The write is manual. Lazer must be closed. `client.realm` is copied first, before the write connection opens (last 5 backups kept). Extraction is paused for the write. The commit holds the shared Realm write lock (see `features/smart-collections/` rule 7); a second Realm write gets HTTP 409 `in_flight`.
6. Written scores get a new Realm id, standardised `TotalScoreVersion` 30000019, and no replay. Statistics JSON is copied through.
7. The write process upserts those rows into the local mirror and records an import whose watermark is copied from the previous successful extraction.
8. Scores absent from the file are left alone. Two PCs converge by exporting each way.

## Security rules

N/A — client app API has no auth. See [business/local-no-auth.md](../../business/local-no-auth.md).

## Important symbols

- `apps/server/src/score-transfer/transfer.ts:exportScoreTransferChunks()` / `exportScoreTransferStream()`
- `apps/server/src/score-transfer/transfer.ts:previewScoreTransfer()`
- `apps/server/src/score-transfer/transfer.ts:commitScoreTransfer()`
- `apps/server/src/shared/realmWriteLock.ts` — `tryAcquireRealmWriteLock()`
- `apps/realm-reader/src/writeScoreTransfer.ts:runScoreTransferWrite()`
- `apps/realm-reader/src/scoreTransferMatch.ts:classifyTransferScore()`

## Dependencies

- `features/live-sync/` — extraction must be paused; the following import picks up written scores
- `features/smart-collections/` — owns the shared Realm write lock rule (rule 7) and the backup-before-open order

## Depended on by

- Settings Setup — score transfer panel

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Score transfer
- [business/realm-read-only.md](../../business/realm-read-only.md)
- [flows/score-transfer.md](../../flows/score-transfer.md)
