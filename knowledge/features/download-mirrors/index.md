---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/mirrors.ts
  - apps/server/src/mirrors/batchJob.ts
  - apps/server/src/mirrors/onlineQuery.ts
  - apps/server/src/mirrors/searchOnline.ts
  - apps/server/src/mirrors/hubSearch.ts
  - apps/server/src/query-language/parse.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/public/features/download
---

# Download mirrors

## Purpose

Fetch beatmap sets via configured mirrors (hinai / nerinyan / osu.direct) from the UI.

## Business rules

1. Only one mirror batch download runs at a time (`job.running`).
2. "Count all missing" / "Download all missing" require **Hide maps I already own** to be active on the submitted search (they always exclude owned/pending server-side).
3. Toggling that checkbox commits immediately so those actions do not stay disabled until Search.
4. In-memory locks (`job.running`, `openingInProgress`) are cleared on server startup via `clearStuckMirrorBatchLocks()` (same pattern as `clearStuckRealmReaderPause`).
5. A second **Stop** while status is already `stopping` force-clears the lock so the UI cannot stay stuck if a download slot ignored cancellation.
6. Download search QL accepts glued mode filters (`mode=m`, `mode=mania`) and short aliases (`m`, `o`, `t`, `c`, `f`) — same as hub browse — so they are not mistaken for free-text mirror `query`.
7. Paginated search, **Count all missing**, and **Download all missing** prefer a primed Hub search cache when `hubCacheKeymode(postFilters)` allows it: no non-star post-filters, or a single exact `key=N` (star bounds may also be present). Star post-filters are ignored for eligibility — they already map to `min_stars`/`max_stars` on the Hub query identity (Hinamizawa set-level filter during prime); Hub stubs have no per-diff stars. Lookups forward `sort` via `mirrorParamsToHubQuery` so they match admin primes (admin UI defaults to Recently ranked / `ranked_desc`). Cache miss or Hub down falls back to the live mirror crawl. Owned/pending subtraction is an ID-set intersect against local hide ids — not `total − count(owned mania ranked)`.

## Important symbols

- `apps/server/src/routes/mirrors.ts`
- `apps/server/src/mirrors/batchJob.ts:clearStuckMirrorBatchLocks()`
- `apps/server/src/mirrors/batchJob.ts:stopMirrorBatchJob()`
- `apps/server/src/mirrors/hubSearch.ts:tryFetchAllHubCachedIds()`
- `apps/server/src/mirrors/hubSearch.ts:mirrorParamsToHubQuery()`
- `apps/server/src/mirrors/onlineQuery.ts:hubCacheKeymode()`
- `apps/server/src/mirrors/searchOnline.ts:collectMatchingOnlineBeatmapsets()`
- `apps/server/public/features/download/*`

## Dependencies

- `features/hub/` — Hub search index URL via `resolveHubBaseUrl()` / `HUB_URL`
- settings / path configuration for download targets (inferred — confirm when changing)

## Depended on by

- (standalone download UX)

## Related knowledge

- [features/hub/index.md](../hub/index.md)
- [architecture/hub-vs-local.md](../../architecture/hub-vs-local.md)
