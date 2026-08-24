# Server backend analysis — `apps/server/src`

**Status (2026-08-24):** findings implemented. Corrections vs the original write-up:
- **C1** — 120-map backfill was only on `dan:`/`pattern:` queries; page enrich + recommend `pick.ts` also computed. All request-path compute removed.
- **H1** — do **not** gate the poll on listener count (analytics + match-count store always subscribe). Dropped `COUNT(*)`; kept `imports` + `MAX(played_at)`.
- **H3** — per-score / per-name UPDATE claims were overstated. Implemented transaction + batched dirty metrics + skip empty name scan. Did not scope by `changedScoreIds`.
- **M1** — UI does not poll `/batch` while idle. Reconcile now runs once per idle period.
- **M5** — overlapping write-back is **409 `in_flight`**, not a shared in-flight promise.

Audit date: 2026-08-24. Severity: critical / high / medium / low.
Cross-checked against `packages/db/src/schema.ts` (existing indexes) and the
realm-reader sync design (`docs/analysis/realm-reader-and-db.md`).

---

## C1. Synchronous dan/pattern computation inline in every list request

**Severity: critical** — verified
**Files:** `apps/server/src/query-language/execute.ts:302-311, 330-371, 390-396`;
`apps/server/src/map-analysis/computeSunnyDan.ts:348-366`;
`apps/server/src/map-analysis/computePatternAnalysis.ts:814`

```ts
function maybeBackfillDan(db: Db, needsDanBackfill: boolean): void {
  if (!needsDanBackfill) return;
  backfillSunnyDanSync(db, { limit: DAN_QUERY_BACKFILL_LIMIT }); // 120 maps
  backfillDanielDanSync(db, { limit: DAN_QUERY_BACKFILL_LIMIT }); // 120 maps
}
...
const items = db.$client.query(listSql).all(...) as PracticeCardRow[];
return { items: enrichSunnyLabels(db, items), total };
```

Any query whose AST mentions dan rating or pattern analysis triggers, **inside
the HTTP handler**, a synchronous backfill of up to 120 maps per estimator:
per map that is `readFileSync(filePath, "utf8")` of the full `.osu` file plus
the star-rating algorithm plus several SQLite round-trips. Additionally
`enrichDanLabels` runs `ensureSunnyDanForIdsSync` /
`ensureDanielDanForIdsSync` over whatever mania rows are missing labels on the
returned page.

**Impact:** On a freshly synced library the first Practice/Search pages issue
hundreds of file reads and CPU-bound estimations in the request path. Bun's
event loop is single-threaded, so *every* concurrent endpoint stalls — SSE,
covers, tosu proxy, UI polling — for seconds per request until coverage fills
in. Feels like "the app freezes after opening lazer for the first time".

**Fix:** The background jobs already exist (`map-analysis/sunnyDanJob.ts`,
`danielDanJob.ts`, `patternAnalysisJob.ts`). Remove the synchronous backfill
from query paths entirely; let queries read whatever is cached and return null
labels while jobs catch up. If instant coverage is desired, enqueue the page's
missing IDs as a job and let the client refetch when done (the UI already has
an SSE channel to notify on).

---

## H1. SSE poll loop runs `COUNT(*)` over all scores every 1.5 s forever

**Severity: high** — verified
**Files:** `apps/server/src/sse.ts:33-104`; started unconditionally at
`apps/server/src/index.ts:22`.

```ts
const [scoreRow] = await db.select({ n: count(), maxPlayed: max(scores.playedAt) }).from(scores);
...
const handle = setInterval(() => void tick(), intervalMs);
```

`startPollLoop` never checks listener count; each tick issues an unfiltered
`COUNT(*)` + `MAX(played_at)` over `scores` on the shared SQLite file, for the
lifetime of the process, even with zero browser clients.

**Impact:** Constant O(n) index scan every 1.5 s; perpetual WAL read traffic
contending with realm-reader imports; measurable idle CPU on large libraries.

**Fix:** Skip `readState` when there are no listeners (expose a count from
`shared/events.ts`). Better: drop the score probe entirely and derive change
signals from realm-reader's `imports` rows (already polled via
`lastImportId`), keeping only the cheap `MAX(played_at)` which SQLite serves
from an index.

## H2. Missing score-side indexes force repeated scans on the hottest query shape

**Severity: high**
**Files:** `packages/db/src/schema.ts:140-143`; `apps/server/src/query-language/execute.ts:35-141`; `apps/server/src/analytics/scoreUsername.ts:112-131`.

`scores` has indexes only on `online_id`, `legacy_online_id`, `beatmap_id`,
`played_at`. But `baseFrom(ctx)` — used by both COUNT and LIST of every
practice/search/collection-results/distribution request — builds two grouped
subselects:

```sql
LEFT JOIN ( SELECT beatmap_id, ... FROM scores
            WHERE delete_pending = 0 ... ${userFilter} ${modeFilter}
            GROUP BY beatmap_id ) ps ...
LEFT JOIN ( SELECT s.beatmap_id, MAX(sm.retry_index) FROM scores s
            JOIN score_metrics sm ... GROUP BY s.beatmap_id ) rs ...
```

and `buildQueryContext` re-resolves usernames with `GROUP BY user_username`
over all scores on *every* request (default `auto` mode). A single
`GET /practice?page=1` therefore scans `scores` ≥5 times; latency grows
linearly with library size regardless of page LIMIT.

**Fix:**
1. Add composite indexes: `scores(user_username, delete_pending, ruleset_short_name, beatmap_id)` and `scores(beatmap_id, delete_pending)`.
2. Cache resolved username/gamemode context with invalidation on settings change instead of per-request aggregation.
3. Merge `rs` into `ps` (single pass), or persist `max_retry`/session aggregates so they need not be recomputed per request.

## H3. Session engine reloads everything and writes row-by-row on every delta import

**Severity: high**
**Files:** `apps/server/src/analytics/session.ts:34-58, 114-115, 229-258`; invoked from `apps/server/src/analytics/pipeline.ts:171-186` whenever `scoresChanged`.

```ts
const allMetrics = await db.select().from(scoreMetrics);   // entire table
...
for (const [scoreId, sessionId] of scoreToSession) {       // one UPDATE per score
  await db.update(scoreMetrics).set({ sessionId })...
}
```

Importing a single score re-reads *all* metrics, recomputes sessions over
*all* scores, then may rewrite thousands of `score_metrics.session_id` values
one autocommit UPDATE at a time. `backfillSessionNames` similarly issues one
UPDATE per session row. All of it runs synchronously through the driver on the
event loop right when the user just finished playing.

**Fix:** Batch writes (`UPDATE ... FROM (VALUES ...)` chunked in one
transaction); scope rescoring to sessions touched by the delta
(`changedScoreIds` is already available from the import journal); skip name
backfill when no unnamed sessions exist.

## M1. `GET /mirrors/batch` does synchronous directory I/O on every status poll

**Severity: medium-high** — `apps/server/src/mirrors/batchJob.ts:262-294, 345-349`.
When idle, every status poll runs `reconcileIdleSavedPaths()`: `existsSync`
per tracked path plus a full `readdir`+`stat` of the download dir —
synchronously — while the Download Maps UI polls continuously.

**Fix:** Reconcile only on running→idle transition (dirty flag); cache the
archive listing with short TTL; make probes async.

## M2. Collection match-count refresh: N heavy aggregate queries synchronously after each sync

**Severity: medium** — `apps/server/src/shared/collectionMatchCache.ts:39-70`; called from `query-language/execute.ts:539-551` via `setImmediate`. Each smart collection runs `countMatchesPure` = the double-aggregate COUNT of H2. One `sync.finished` event queues a burst of full-table scans exactly when the analytics pipeline and SSE fan-out are also busy.

**Fix:** Yield between collections with a per-tick budget; reuse one prepared statement; skip collections whose query cannot be affected by the delta.

## M3. Batch downloads buffer whole .osz in memory and write synchronously

**Severity: medium** — `apps/server/src/mirrors/batchJob.ts:547-552`.
With up to 10 concurrent slots, each multi-MB archive is fully materialized
(`res.arrayBuffer()`) then written with blocking `writeFileSync` on the main
loop → periodic freezes of SSE/covers/UI during batch downloads.

**Fix:** Stream `res.body` to disk (`Bun.file().writer()`), or at minimum use async `writeFile`.

## M4. Batch page loop ignores upstream `hasMore=false`

**Severity: medium (logic)** — `apps/server/src/mirrors/batchJob.ts:482`.

```ts
if (!result.hasMore && result.mirrorCount === 0) break;
```

If the last page had hits but `hasMore` is false, scanning continues for the
remaining pages, wasting mirror bandwidth/rate-limit budget on duplicates.

**Fix:** Break whenever `!result.hasMore` (keep the zero-count clause only as a safety net).

## M5. Collection→lazer sync has no mutual exclusion

**Severity: medium (logic)** — `apps/server/src/shared/syncCollections.ts:218-329`; three routes call it concurrently without an in-flight guard (`routes/collections.ts:192, 251, 315`). Overlapping calls both flip `realm_reader_paused`, both sleep 2 s, both run the Realm writer; whichever finishes first clears the pause flag early. Risk: overlapping Realm opens / stuck pause state during hub collection adds.

**Fix:** Module-level promise singleton (`if (syncInFlight) return syncInFlight`) mirroring the existing `openingInProgress` pattern.

## M6. Rating-lab job status endpoint recomputes coverage aggregates per poll

**Severity: medium** — `apps/server/src/mania-rating/job.ts:139-239` via `routes/ratingLab.ts:255`: two `COUNT/SUM(CASE …)` scans incl. `json_extract(pp_by_accuracy_json,'$.93')` over all mania beatmaps, polled continuously by the UI *while the job itself is running*, slowing the very job being watched.

**Fix:** Snapshot coverage at job start; increment counters from `computedThisRun`; refresh only on completion.

## L1. SSE stream has no heartbeat

`sse.ts:110-155` — nothing written between real events; idle connections behind proxies die silently; dead listeners linger until abort. Add `: ping\n\n` every ~20 s per connection, cleared in `cancel()`; prune `listeners` when `enqueue` throws.

## L2. LIKE wildcard inconsistency in QL compiler (logic, not SQLi)

`compile.ts:78,135,270-274` — values are parameter-bound (safe) and
`title:`/`artist:` escape `%`/`_` via `likePattern()`, but `mapper:`, `mods:`
and bare-text branches don't. `mapper:%` matches far more than intended.
Route all branches through `likePattern(term.value, term.prefix)`.

## L3. Unbounded `md5ListCache` keyed by user input

`shared/syncCollections.ts:41,158-160,197` — entries evicted only by the global
`invalidateCollectionMd5Cache()` on sync.finished; arbitrary hub ID lists add
megabyte-scale entries retained for process lifetime. Cap with small LRU/TTL.

## L4. Collection .osz export buffers entire ZIP in memory with sync reads

`map-analysis/exportOsz.ts:170,354-368` via `routes/collections.ts:501-507` —
up to 100 sets × difficulties × assets read with `readFileSync` into one
in-memory zip inside the request handler: multi-hundred-MB spike, seconds-long
stall of every other request. Stream entries into a temp file / ReadableStream.

## L5. Single-save download races batch start

`mirrors/batchJob.ts:809-858` — the long awaited download happens after the
`job.running` check without setting any flag; a batch can start mid-save and
interleave script regeneration. Set a lightweight `saving` flag around it.

## Summary (top 5)

1. **C1** inline dan/pattern backfill — biggest user-visible stall; move to background jobs.
2. **H2** missing score indexes + per-request context resolution — cheapest high-yield fix.
3. **H1** SSE COUNT probe every 1.5 s forever — gate on listeners.
4. **H3** session engine O(all-scores) rewrite per imported score.
5. **M5** unguarded concurrent collection→lazer syncs — correctness risk, one-line guard.
