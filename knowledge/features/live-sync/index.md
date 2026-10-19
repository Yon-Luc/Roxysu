---
last_verified: 2026-10
confidence: verified
touches:
  - apps/realm-reader/src/index.ts
  - apps/realm-reader/src/sync.ts
  - apps/realm-reader/src/upsert.ts
  - apps/realm-reader/src/importJournal.ts
  - apps/realm-reader/src/reconcileCore.ts
  - apps/realm-reader/src/deltaCore.ts
  - apps/realm-reader/src/syncRealmCollections.ts
  - apps/realm-reader/schemas/osu-client.schema.json
  - packages/db/src/failStaleRunningImports.ts
  - packages/db/src/schemaVersion.ts
  - apps/server/src/staleImportSweep.ts
  - packages/db/src/settings-keys.ts
  - apps/server/src/shared/realmWriteLock.ts
  - apps/realm-reader/src/schemaMismatch.ts
  - apps/realm-reader/src/map.ts
  - apps/realm-reader/src/map.test.ts
  - apps/realm-reader/src/stream.test.ts
  - apps/realm-reader/src/reconcileForeignKeys.test.ts
  - packages/db/src/foreignKeys.ts
  - apps/server/src/sse.ts
  - apps/server/src/routes/system.ts
  - apps/server/public/components/SchemaOutdatedDialog.tsx
  - apps/server/src/analytics/pipeline.ts
  - apps/server/src/shutdownJobs.ts
---

# Realm extraction

## Purpose

Continuously extract Realm beatmaps and scores into the local mirror; surface Synced / Syncing / Paused / Failed in the UI over SSE. Optional pause when the browser tab is unfocused.

**In UI:** "Live sync" — canonical term: **Realm extraction**.

## Business rules

1. Prefer watermark incremental extraction; reconcile periodically; full remap only on first import / one-shot `REALM_FULL_SYNC=1` (consumed after the first successful full cycle).
2. Soft-deleted Realm **Score** and **BeatmapSet** objects upsert with `delete_pending = true`. Realm Beatmap has no `DeletePending`; difficulty hide uses `hidden`. Incremental and reconcile cycles compare the **id sets** of flagged Realm objects (`Score` and `BeatmapSet` `DeletePending == true`, `Beatmap` `Hidden == true`) with the flagged local-mirror rows, and remap every id present in exactly one side (a restore plus a delete that leave the counts equal still heal). Ids whose Realm object no longer exists are left to orphan deletion. Successful imports prune the `imports` journal to the newest 500 rows.
3. Incremental cursor is the last successful import's `watermark_played_at` / `watermark_last_local_update`, not `MAX()` from data tables. With no successful import at all (first run, or a bootstrap killed before it committed) there is no cursor: `getWatermarks` returns none and `runIncrementalSync` runs a full extraction, so a half-extracted mirror is never treated as complete. The `MAX()` fallback applies only after a successful import that recorded no watermark (empty Realm).
4. Stuck pause cleared on server/reader startup (`clearStuckRealmReaderPause`). Stale `running` imports are marked failed two ways: the reader fails every `running` row at its start (`failStaleRunningImports`, it is the only writer), and the server fails `running` imports older than `STALE_RUNNING_MS` (10 min, shared with the analytics gate) at boot and then at most once a minute from the import poll loop (`failStaleRunningImportsOlderThan` via `createStaleImportSweep`), so a dead reader does not leave the Synced / Syncing indicator stuck. A live reader overwrites the row with its final status by id, so a false positive on a very long import self-heals.
5. Every Realm write (collection write-back, online score pull commit, score transfer commit) sets `sync.realm_reader_paused` for the duration of the write. The pause is reference-counted in `apps/server/src/shared/realmWriteLock.ts`: `"1"` from the first holder's acquire, `"0"` only when the last holder releases.
6. Realm collection extract is isolated from the score/beatmap write; a bad collection cannot fail the import.
7. Extraction is **streamed** (`upsert.ts`, `deltaCore.ts`): full extraction, the incremental watermark delta, and flag healing map and upsert rows in bounded batches (500), hydrating a batch's sets, beatmaps and rulesets per batch — never materialize a whole class or delta of Realm objects in memory. Changed ids are capped at the analytics full-rebuild threshold (5000), beyond which the import records a null delta (see [decisions/stream-extraction-stall-breaker.md](../../decisions/stream-extraction-stall-breaker.md)).
8. Missed-row healing runs on reconcile only; incremental cycles import their watermark delta without count-gate catch-up scans.
9. Reconcile catch-up stops after 3 fruitless rounds against an unshrinkable row-count gap (`sync.catchup_stalled`), and resets when an incremental imports rows again or the gap closes. A round is fruitless only when the missing-id catch-up moved zero rows; orphan deletes never re-arm or advance the counter. A tripped breaker skips only the catch-up: reconcile still collects the Realm id sets and deletes orphans (so it costs one Realm id scan per reconcile while the gap is open, with no catch-up upserts).
10. Failed cycles back off exponentially (`REALM_RETRY_MS` base, `REALM_RETRY_MAX_MS` cap) instead of retrying flat every 10 s.
11. When the Realm file schema is newer than the bundled osu schema, extraction writes `sync.schema_outdated` and waits until shutdown (no retry, no exit). The client app shows a non-dismissible notice that a matching Roxysu version is coming, with a link to GitHub. A successful Realm open clears the setting immediately.
12. Non-finite Realm numbers on required columns are stored as the column fallback (0, or -1 for a ruleset online id). A beatmap whose `StarRating` is NaN must not fail the extraction cycle. Optional numerics that are non-finite are stored as null.
13. A constraint error on one raw-import row does not fail the cycle. The batch is split until that row is alone, the row is skipped and logged, and the rest commit. The row stays missing, so reconcile catch-up retries it; a later valid Realm value imports on its own. A row that stays invalid is covered by the catch-up stall breaker.
14. Null or missing Realm primary IDs soft-skip the row (`mapBeatmapSet` / `mapBeatmap` / `mapScore` return null) — they must not throw and abort the cycle.
15. Invalid Realm dates are rejected: required timestamps (`dateAdded`, `playedAt`) fall back to epoch; optional dates become null. Watermarks advance only from rows that successfully upserted; non-finite timestamp ms are ignored.
16. The analytics pipeline never reads the local mirror while the latest `imports` row is `running` and its heartbeat is fresh: raw rows commit in batches before the import is finished, so a rebuild would see a partial library. `waitForIdleImport` / `importGateDecision` (`apps/server/src/analytics/pipeline.ts`) block every pipeline entry point (SSE-scheduled runs, boot debounce, forced full rebuild) until the row leaves `running`, with no timeout that proceeds anyway. Stale means no `progress_at` (else `started_at`) for 10 minutes. The realm-reader sets `progress_at` on claim and touches it at most every 30 s during streamed batches, so a long live import is not stale. The server sweep uses the same cutoff. `importNeedsForcedFull` then forces a full rebuild only after the writer is presumed dead. `score.imported` / `dashboard.updated` events still reach the UI immediately; only analytics work is deferred. A score-filter settings PATCH fires the pipeline without awaiting it.
17. Schema migrations are applied only by `apps/server`; the reader waits for the schema to be current before extracting (see [decisions/dual-runtime-sqlite-bus.md](../../decisions/dual-runtime-sqlite-bus.md)).
18. **Commit phase.** Streaming batches autocommit (each holds the SQLite write lock only briefly); the import row stays `running` until `commitImport` (`importJournal.ts`), one short immediate transaction that holds the orphan deletes, stall counter, one-shot flags (replay-hash backfill), watermarks and the `success` flip together. Readers trust the local mirror only through the latest `success` import (rule 16, `hasSuccessfulImport`, rule 3), so an interrupted cycle never looks finished; its failure rolls back the commit phase as a unit. A single transaction around the whole streaming extraction was rejected (WAL write lock held for the full library; see [decisions/extraction-commit-phase.md](../../decisions/extraction-commit-phase.md)).
19. **Shutdown stops writers before the mirror closes.** On SIGINT/SIGTERM the client app stops event subscriptions, then `app.stop`, then `shutdownBackgroundWork()` (`apps/server/src/shutdownJobs.ts`), then `closeDb`. `shutdownAnalyticsPipeline()` refuses new runs, clears the debounce and boot timers, ends the import wait loop, and awaits the in-flight run for at most 3 s (engines have no abort hook, so a run inside an engine finishes that pass). The backfill jobs (dan variants, sunny/daniel/rework dan, pattern analysis, mania rating) and the mirror batch job get their stop requested; jobs whose batch awaits are polled idle within the same bound. That poll reads in-memory `job.status` only (`getManiaRatingJobStatus`, `getReworkDanJobStatus`, `getPatternAnalysisJobStatus`) and does not run coverage SQL. A timeout is logged, not fatal: the process still closes the mirror and exits (desktop SIGKILLs after 5 s anyway).
20. **Foreign keys are enforced on the local mirror** (see [architecture/local-mirror.md](../../architecture/local-mirror.md)). Extraction writes parents first (sets, then beatmaps, then scores; a score batch hydrates its missing beatmaps, and a reference that cannot resolve is nulled). A row whose parent is missing fails as a constraint error and is skipped by the bisect (rule 13), then retried by reconcile catch-up. `reconcileDeletes` removes children before parents inside the commit phase: `score_metrics` before scores; mastery, notes, beatmap tags, dan ratings, dan rating variants, mania ratings, pattern analysis and Roxysu Play results before beatmaps (scores are detached with `beatmap_id = NULL`); a set is deleted only when no surviving beatmap references it. Roxysu Play results on a beatmap deleted from Realm are deleted with it.

## Important symbols

- `apps/realm-reader/src/index.ts`
- `apps/realm-reader/src/sync.ts`
- `apps/realm-reader/src/importJournal.ts` — `commitImport()`, `touchImportProgress()`, `getWatermarks()`, `hasSuccessfulImport()`, `failImport()` (Realm-free, tested under Bun)
- `apps/realm-reader/src/reconcileCore.ts` — `startCountGapRound()` / `finishCountGapRound()`, `reconcileDeletes()`, stall counter helpers
- `apps/realm-reader/src/deltaCore.ts` — `streamIncrementalDelta()`, `DeltaWriter`, `healFlaggedRows()`, `ExtractionSource` (Realm read side; adapter `realmSource()` in `sync.ts`)
- `apps/realm-reader/src/upsert.ts` — batch upserts, constraint bisect, `streamMappedUpsert`
- `apps/realm-reader/src/syncRealmCollections.ts`
- `packages/db/src/failStaleRunningImports.ts` - `failStaleRunningImports`, `failStaleRunningImportsOlderThan`, `STALE_RUNNING_MS`
- `packages/db/src/schemaVersion.ts` - `waitForSchemaCurrent`
- `apps/server/src/staleImportSweep.ts` - `createStaleImportSweep`
- `packages/db/src/settings-keys.ts` — `SYNC_CATCHUP_STALLED_KEY`, `SYNC_SCHEMA_OUTDATED_KEY`
- `apps/realm-reader/src/schemaMismatch.ts` — `toSchemaVersionMismatchError()`
- `apps/realm-reader/src/map.ts` — `mapBeatmap()` / `mapBeatmapSet()` / `mapScore()` soft-skip null IDs; coerce non-finite numbers and invalid dates
- `apps/realm-reader/src/upsert.ts` — `streamMappedUpsert` `onUpserted` runs only after a successful commit
- `apps/server/public/components/SchemaOutdatedDialog.tsx`
- `apps/server/src/analytics/pipeline.ts` — `importGateDecision()`, `waitForIdleImport()`, `shutdownAnalyticsPipeline()`
- `apps/server/src/shutdownJobs.ts` — `shutdownBackgroundWork()`
- `apps/server/src/sse.ts` — poll `imports` + `MAX(played_at)` (no `COUNT(*)`); SSE `: ping` heartbeat ~20s

## Dependencies

- [architecture/local-mirror.md](../../architecture/local-mirror.md)
- [architecture/data-ownership.md](../../architecture/data-ownership.md)
- `packages/osu-paths`

## Depended on by

- Nearly all practice features (scores/beatmaps source of truth in local mirror)
- `features/smart-collections/` — pause during collection write-back
- `features/online-score-pull/` — pause during the Realm score write
- `features/skin-fusion/` — reads `realm_skins` / `realm_skin_files` rows and archives
- `features/score-transfer/` — pause during the Realm score write
- `features/bms/` — interprets BMS scores already stored by extraction

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Realm extraction, Import
- [flows/realm-extraction-to-ui.md](../../flows/realm-extraction-to-ui.md)
- [business/realm-read-only.md](../../business/realm-read-only.md)
- [decisions/stream-extraction-stall-breaker.md](../../decisions/stream-extraction-stall-breaker.md)
- [decisions/extraction-commit-phase.md](../../decisions/extraction-commit-phase.md)

**In code:** feature folder `live-sync/`, module `sync.ts`.
