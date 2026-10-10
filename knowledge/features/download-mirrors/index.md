---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/routes/mirrors.ts
  - apps/server/src/mirrors/batchJob.ts
  - apps/server/src/mirrors/downloadArchive.ts
  - apps/server/src/mirrors/onlineQuery.ts
  - apps/server/src/mirrors/searchOnline.ts
  - apps/server/src/mirrors/hubSearch.ts
  - apps/server/src/mirrors/onlineQuery.ts
  - apps/server/src/query-language/parse.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/public/features/download
  - apps/server/public/features/download/DownloadSearchGrid.tsx
---

# Download mirrors

## Purpose

Fetch beatmap sets via configured mirrors (hinai / nerinyan / osu.direct) from the UI.

## Business rules

1. Only one mirror batch download or single-save runs at a time (`job.running` / `savingInProgress`).
2. "Count all missing" / "Download all missing" require **Hide maps I already own** to be active on the submitted search (they always exclude owned/pending server-side).
3. Toggling that checkbox commits immediately so those actions do not stay disabled until Search.
4. In-memory locks (`job.running`, `openingInProgress`) are cleared on server startup via `clearStuckMirrorBatchLocks()` (same pattern as `clearStuckRealmReaderPause`).
5. A second **Stop** while status is already `stopping` force-clears the lock so the UI cannot stay stuck if a download slot ignored cancellation.
6. Download search QL accepts glued mode filters (`mode=m`, `mode=mania`) and short aliases (`m`, `o`, `t`, `c`, `f`) — same as hub browse — so they are not mistaken for free-text mirror `query`.
7. Paginated search, **Count all missing**, and **Download all missing** prefer a primed Hub search index when `hubCacheKeymode(postFilters)` allows it: no non-star post-filters, or a single exact `key=N` (star post-filters may also be present). Hub looks up the **base** prime (`mode`/`status`/`key`/`sort`) and applies secondary filters in SQL. Page search uses `GET /search`; count/download-all use one `GET /search/all`. Lookups forward `sort` + secondary params via `mirrorParamsToHubQuery` so they match admin base primes (admin UI defaults to Recently ranked / `ranked_desc`). Cache miss, `HUB_SEARCH_INDEX=0`, Hub 5xx/timeout (then a 30s circuit skip), or Hub down falls back to the live mirror crawl. Owned/pending subtraction is an ID-set intersect against local hide ids — not `total − count(owned mania ranked)`. A hub page that shrinks after hide is refilled from later SQL pages.
  8. Download Maps browse is infinite scroll (`useInfiniteQuery` + virtualized grid). Search / sort / hide-owned reset to page 0. **Download N pages** always starts at the top of the current search (`startPage: 0`). A single card Download hides that set locally and does not refetch loaded pages. The window virtualizer seeds `initialOffset` from router scroll restoration so a restored scroll still renders the rows at that offset.
  9. Batch ETA uses `downloadingStartedAt` (set when phase flips to downloading — not job `startedAt`, which includes scan). Remount / reload mid-batch keeps that epoch. When `processed >= queued` while still busy the label is "Wrapping up…".
10. Single-save, batch pages/query, and Community collection `mode=setIds` downloads try the active mirror first, then fall back across the other configured providers. Hinai often 503s pending sets that osu.direct still serves; do not treat a single-provider failure as final.
11. Live mirror paging treats any non-empty page as “maybe more” (`mirrorPageSuggestsMore`). Graveyard upstream pages are routinely short (&lt;100) and must not end the crawl. Graveyard overfetch/collect stays sequential (no parallel page jumps — hinai’s cursor ledger returns empty on cold deep jumps).

## Important symbols

- `apps/server/src/routes/mirrors.ts`
- `apps/server/src/mirrors/batchJob.ts` — page loop stops on `!hasMore`; idle dir reconcile once per idle period; single-save shares the batch lock
- `apps/server/src/mirrors/downloadArchive.ts:downloadBeatmapsetArchiveToPath()` — multi-provider `.osz` fetch used by batch + single-save
- `apps/server/src/mirrors/batchJob.ts:stopMirrorBatchJob()`
- `apps/server/src/mirrors/batchJob.ts` — `downloadingStartedAt`
- `apps/server/public/features/download/batchProgress.ts:estimateBatchEta()`
- `apps/server/src/mirrors/hubSearch.ts:tryFetchAllHubCachedIds()` — single `GET /search/all`
- `apps/server/src/mirrors/hubSearch.ts:mirrorParamsToHubQuery()`
- `apps/server/src/mirrors/hubSearch.ts:tryHubCachedSearch()` — paged `GET /search` + circuit breaker
- `apps/server/src/mirrors/onlineQuery.ts:hubCacheKeymode()`
- `apps/server/src/mirrors/searchOnline.ts:collectMatchingOnlineBeatmapsets()`
- `apps/server/src/mirrors/searchOnline.ts:mirrorPageSuggestsMore()`
- `apps/server/public/features/download/*`
- `apps/server/public/features/download/DownloadSearchGrid.tsx` — window-virtualized 1/2/3-col grid; loads next page near the last row

## Dependencies

- `features/hub/` — Hub search index URL via `resolveHubBaseUrl()` / `HUB_URL`; Community save starts `mode=setIds` for missing set ids
- settings / path configuration for download targets (inferred — confirm when changing)

## Depended on by

- `features/map-marathon/` — saves the fused `.osz` to the beatmaps folder and calls `openOszWithOsu`
- `features/hub/` — Save collection downloads missing beatmapsets via `startMirrorBatchJob({ mode: "setIds" })`

## Related knowledge

- [features/hub/index.md](../hub/index.md)
- [architecture/hub-vs-local.md](../../architecture/hub-vs-local.md)
