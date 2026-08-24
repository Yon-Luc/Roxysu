# Realm-reader & local-mirror analysis — `apps/realm-reader/src`, `packages/db/src`

Audit date: 2026-08-24. The extraction design is fundamentally sound:
watermark-filtered Realm queries (not full JS scans), 500-row chunked upserts,
SQL-level no-op suppression via `IS DISTINCT FROM` (`sync.ts:146-165`), WAL +
30 s busy_timeout on both clients, sequential non-overlapping poll loop
(`index.ts:128-137,190`). The findings below are about crash windows,
soft-delete coverage and write amplification.

---

## C1. Crash between data commit and `finishImport` permanently skips analytics for those scores

**Severity: critical** — verified
**Files:** `apps/realm-reader/src/sync.ts:1199-1274` (upserts autocommit at
1201-1224; `finishImport` at 1262); watermark derivation at `sync.ts:305-325`;
server-side loss path `apps/server/src/analytics/pipeline.ts:52-102,174-175`.

There is **no transaction anywhere in realm-reader**: every 500-row upsert
batch is its own implicit transaction. Watermarks are recomputed from committed
data (`max(scores.playedAt)`), so after a mid-cycle kill the next incremental
cycle finds nothing new and records a *successful* no-op import
(`rowsChanged = 0`). The server pipeline that was waiting in
`waitForIdleImport` then reads this latest successful import, gets empty
deltas, and logs "delta empty — skip engines".

**Impact:** Scores written by the crashed cycle exist in `scores` but never get
retry/session/mastery/statistics rows. Silent, permanent analytics hole after
any crash/kill/power-loss during an active sync; self-heals only if a full
rebuild happens to run later.

**Fix (either):**
1. Persist watermarks inside the `imports` row written transactionally with `finishImport`, instead of deriving them with `MAX()` from data tables; or
2. Wrap the whole cycle (upserts + reconcile + `finishImport`) in one deferred transaction via the synchronous driver (`db.transaction`).
Also make the server treat "latest import is running/failed while score count advanced" as a forced-full signal.

## H1. Beatmap soft-deletes are never extracted outside full sync

**Severity: high** — verified gates at `sync.ts:1121-1138` (incremental) and
`sync.ts:926-943` (reconcile): only `Score` and `BeatmapSet` have
`DeletePending == true` count gates. There is no `Beatmap.DeletePending`
gate anywhere.

**Impact:** `beatmaps.delete_pending` stays 0 until a manual
`REALM_FULL_SYNC`. Server excludes soft-deleted difficulties everywhere
(`sqlFragments.ts:7`, `compile.ts:132,236`), so deleted difficulties remain
permanently visible/searchable in the practice library — violating the
documented rule in `knowledge/architecture/local-mirror.md`.

**Fix:** Add the missing `Beatmap.DeletePending` count gate mirroring the Score/Set ones in both incremental and reconcile paths.

## H2. Collections mirror fully rewritten every cycle in thousands of tiny autocommit transactions

**Severity: high** — verified
**Files:** `apps/realm-reader/src/syncRealmCollections.ts:60-123`; called
unconditionally from all three sync paths (`sync.ts:813, 1007, 1250`).

Per collection per cycle (even when nothing changed — `LastModified` is stored
but never compared): one upsert, one full `DELETE FROM realm_collection_hashes`,
reinsert in 400-row chunks — each `.run()` a separate implicit transaction.
Cleanup then deletes stale mirror rows one-by-one. Plus
`resolveMd5ToOnlineIds` re-runs the MD5→set join over all hashes every cycle.

**Impact:** Hundreds-to-thousands of short write-lock acquisitions per minute
on the shared SQLite file → WAL churn, fsync storm, lock contention against
the server's 1.5 s poller; pointless CPU on unchanged data.

**Fix:** Skip collections whose `lastModified`+`hashCount` match the stored row; wrap the whole function in one transaction; batch collection upserts like `upsertBatches`; diff-based hash deletion instead of delete-all-reinsert; isolate collection failures from the score/beatmap pipeline (try/catch).

## M1. Duplicate MD5 inside one Realm collection crashes the entire extraction loop forever

**Severity: medium-high (logic)** — `syncRealmCollections.ts:101-110` inserts
`col.hashes` raw against PK `(collection_id, md5_hash)` with no
`onConflictDoNothing` and no per-collection dedup (`uniqueHashes` dedups only
the lookup list). One constraint violation throws through
`runIncrementalSync`'s catch → `failImport` → retry in 10 s → same failure
forever, blocking *all* score extraction.

**Fix:** Dedup hashes per collection before insert; add `onConflictDoNothing`; try/catch around the collections step so it can't starve the score pipeline.

## M2. Whole-library materialization in memory during full sync / catch-up

**Severity: medium** — `sync.ts:327-383` (`collectMappedRows`: all scores/
beatmaps/sets mapped to JS objects kept alive for the whole cycle),
`:386-423` + `:1247` (`collectRealmIdSets` builds 3 more full UUID sets;
`sqliteIdSet` loads all SQLite IDs). ~6 simultaneous full-library sets on large
libraries → spiky multi-hundred-MB RSS in a long-lived process.

**Fix:** Page through Realm filtered snapshots; free batch references; reuse count-gates instead of ID-set diffs where possible.

## M3. Missing index for the per-poll watermark query

**Severity: medium** — `getWatermarks` runs `MAX(beatmaps.lastLocalUpdate)`
every cycle but no index exists on `last_local_update`
(`packages/db/src/schema.ts:98-102`). Full scan of `beatmaps` each minute.
Related: server filters mania via
`lower(COALESCE(b.ruleset_short_name,'')) = 'mania'`
(`danielDanJob.ts:65`, `computePatternAnalysis.ts:863`) which no index can
serve as written.

**Fix:** `CREATE INDEX beatmaps_last_local_update_idx ON beatmaps(last_local_update)`; rewrite the server filters to bare equality and index `ruleset_short_name`.

## M4. Foreign-key enforcement disabled in both mirror clients

**Severity: medium** — `client.node.ts:20-32`, `client.bun.ts:18-25` set WAL
and busy_timeout but never `PRAGMA foreign_keys = ON` (the hub DB does:
`apps/hub/src/db.ts:17`). Schema declares FK cascades that silently never fire
on the mirror. realm-reader compensates manually (nulling unknown refs,
child-before-parent deletes); server-side writers have no such safety.

**Fix:** Enable FK enforcement after auditing server deletes for ordering, or add explicit cascade deletes where semantics allow.

## M5. `imports` journal grows unbounded

One row per 60 s cycle even with zero changes (~500k rows/yr), each carrying a
JSON `changed_score_ids` blob up to 5000 ids; no pruning exists. Prune in
`claimImport` (retain N days / K rows).

## M6. Bun vs node prepared-statement behavior mismatch

`client.node.ts:27-31` prepares fresh on every `query()` call while bun:sqlite
caches internally. Hot loops on the node client re-parse SQL each call.
Memoize statements in a `Map<string, Statement>` shim.

## M7. `REALM_FULL_SYNC=1` makes every cycle a full remap

`index.ts:31,179` evaluates the env var inside the forever-loop; intended as a
one-shot bootstrap override it instead repeats full remaps until restart.
Consume once (or exit after the forced full).

## L1–L4 (low)

- **Busy-retry blocks event loop up to ~6 s** (`sync.ts:100-121`, `sleepSync`
  exponential backoff, no shutdown responsiveness during it). Cap total backoff.
- **Stale `running` import rows never swept** — hard kill leaves status
  `running` forever; `waitForIdleImport` then waits its full 5-minute timeout
  (`pipeline.ts:79-86`). Sweep stale rows on reader startup.
- **Count-gate blind spots** — net-zero change cycles (1 added + 1 deleted)
  skip orphan cleanup until counts diverge again. Self-heals; note only.
- **Null `Date` scores become epoch 1970** (`map.ts:33-35,199` fallback
  `new Date(0)`) — distorts session splitting/timelines. Prefer skipping such
  rows or handling a sentinel in analytics.
- **Collection write-back backs up a live Realm file** with `copyFileSync`
  while open for write (`syncCollections.ts:109`) — copy may be torn. Back up
  before opening for write or use Realm's compact/copy API.
- **`splice(0, len, ...hashes)` spread risk** (`syncCollections.ts:84-86`) —
  >~100k-element arrays can exceed arg limits. Chunk the splice.

## Summary (top 4)

1. **C1** crash-window analytics loss — persist watermarks with the import journal.
2. **H1** missing Beatmap soft-delete gate — deleted maps stay visible forever.
3. **H2** unconditional collections rewrite in autocommit storms — skip-if-unchanged + single transaction.
4. **M1** one bad collection blocks all extraction indefinitely — dedupe/conflict-ignore + isolation.
