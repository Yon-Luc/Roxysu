# Hub analysis — `apps/hub/src`, `packages/db/src/hub`

Audit date: 2026-08-24. The hub's search design follows its decision doc
(`knowledge/decisions/hub-search-base-index.md`): base-prime identity rows +
killable edge cache, single-flight cron refresh with failure backoff
(`cacheRefreshCron.ts:8,40-42`), atomic index replacement inside a transaction
on refresh (`cache.ts:618-633`), and `PRAGMA foreign_keys = ON`
(`db.ts:17`) so the schema's cascades actually work. Findings below are real
gaps observed on top of that design.

---

## H1. Per-beatmapset HTTP crawl inside POST/PUT collection handlers

**Severity: high**
**Files:** `apps/hub/src/services/collectionStats.ts:157-187`;
called from `routes/collections.ts:438` (create) and `:525-527` (update).

```ts
async function fetchHinaiSetDiffs(setId: number): Promise<DiffSample[]> {
  const res = await fetch(`https://mirror.hinamizawa.ai/v3/osu/beatmaps/s/${setId}`, ...);
}
...
for (const batch of chunk(unique, FETCH_CONCURRENCY * 2)) {
  const parts = await mapPool(batch, FETCH_CONCURRENCY, fetchHinaiSetDiffs);
```

Creating or updating a collection issues **one upstream HTTP request per
beatmapset** (body allows up to 2000) at concurrency 8 with a 12 s timeout —
inside the request handler. A 1000-map collection ≈ 125 sequential batches ×
RTT: minutes-long requests, Hinamizawa rate-limit pressure, and on any failure
the diffs silently vanish → `starsMin/Max/dominantMode` persisted as NULL,
degrading browse filters permanently (no retry path).

**Fix:** Persist raw `beatmapsetIds` immediately; compute stats in a background
job that backfills `collections.stars_*`; reuse the search-v2 endpoint (which
returns embedded difficulties for many sets per page) instead of `/s/{id}`
N+1; add a stats-refresh sweep for rows with NULL stats.

## H2. List endpoints are N+1 × 5 queries per collection

**Severity: medium**
**File:** `routes/collections.ts:99-205` (`buildCollectionItem`), used by
`GET /collections` (:275-277), `GET /collections/me/favorites` (:381-391).

Each listed collection triggers 5 separate queries (tags, map count, favorite
count, favorited-by-me, preview IDs). With `limit=100` that is ~500 queries
per page request; `/me/favorites` is unbounded over all of a user's favorites.

**Fix:** Aggregate with one grouped query (`GROUP BY collection_id` counts +
`GROUP_CONCAT` tags / json_group_array previews), or batch-load via
`inArray(collectionIds)` maps. Cap favorites page size.

## H3. First-hit blob→index migration runs outside a transaction while serving

**Severity: medium (logic)**
**File:** `services/searchIndex.ts:287-308` (`ensureSearchIndexRows`) calls
`replaceSetsForCache(db, …)` directly — unlike the refresh path
(`cache.ts:618-633`), which correctly wraps it in `db.transaction`. On the
first `/search` hit for a primed-but-unmigrated cache, concurrent readers see
the index partially deleted/empty mid-insert.

**Fix:** Wrap in a transaction like the cron path; guard with an in-flight set so two simultaneous first-hits don't both rebuild.

## M4. HTTP-triggered refresh and cron refresh can run concurrently for the same entry

**Severity: medium (logic)**
**Files:** `routes/search.ts:24,85-98` (`refreshing` Set guards request-path
refreshes only); `services/cacheRefreshCron.ts:8` (`tickRunning` guards
cron-vs-cron only). Nothing is shared between them: a stale-hit-triggered
`refreshCache(rowId)` can overlap the minute-tick deciding the same row is due
— two full catalogue crawls racing, last writer wins, double upstream quota
burn, possible Hinamizawa rate-limiting truncating results.

**Fix:** Move the in-flight guard into module-level shared state keyed by cacheId (or into the DB row: `refresh_started_at` lease checked with a conditional UPDATE).

## M5. Rate-limit buckets: lazy prune only above 10k keys, O(n) on the unlucky request

**Severity: low-medium**
**File:** `services/rateLimit.ts:23-33`. Expired buckets persist until the map
exceeds 10 000 keys, then *one* request pays a full-map iteration + filter of
every bucket synchronously. IP-keyed buckets (`export:${ip}`,
`search:${ip}`) grow with unique visitors behind rotating proxies.

**Fix:** Periodic background sweep (e.g. in the existing minute cron) or cap prune cost amortized per call.

## M6. `/search/all?fields=full` serializes up to 100k full stubs in one response

**Severity: medium**
**File:** `routes/search.ts:101-180` + `searchIndex.ts:167-215`. Rows load via
one query + diff join into JS, then JSON.stringify of up to 100k objects on
the event loop; rate limit is 10/min/IP but multiple IPs multiply it. Also no
compression headers for these large payloads.

**Fix:** Stream NDJSON for `full`, enforce a smaller default `maxSets`, gzip when large, consider caching the serialized dump per base-hash+secondary combination.

## L1–L4 (low)

- **`GET /collections/:id/export` increments `downloadCount` before serving and on every GET** (`collections.ts:318-321`), including bots/aborts; count is marketing-ish anyway but note inflation. Consider counting only 200 responses delivered.
- **`collectionIdsMatchingAllTags` loads every tag row then intersects in JS** (`collections.ts:59-79`) — fine at current scale; use `GROUP BY … HAVING count(DISTINCT tag) = n` if collections grow.
- **`requireAuth` does a DB SELECT per authenticated request** (`middleware/auth.ts:72-81`) — correct-by-design (fresh role), cheap on SQLite; revisit only under load.
- **Secondary text filters force full scans of `search_index_sets`** (LIKE '%…%' over artist/title, `searchIndex.ts:26-35`) — acceptable ≤100k rows; consider FTS5 if hub grows.
- **`PUT /collections/:id` delete-all-reinserts maps/tags inside a transaction** — good; but `computeCollectionStatsFromSetIds` runs *outside* it, so a crash between leaves stats stale relative to new map list (ties into H1 fix).

## Summary (top 3)

1. **H1** per-set upstream crawl in create/update handlers — move to background job, use bulk search endpoint.
2. **H2/H3** list N+1s and non-transactional first-hit migration.
3. **M4** dual refresh paths without a shared single-flight guard.
