---
id: F-025
feature: download-mirrors
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Download-all treats a truncated Hub dump as the full match set

## What

When the Hub search index is eligible, `collectMatchingOnlineBeatmapsets` uses `tryFetchAllHubCachedIds` and returns immediately. `hitPageCap` is set from `hub.truncated`. It does not continue with a live mirror crawl for the rest.

## Why

Hub’s dump stops at `SEARCH_ALL_MAX_SETS` (100,000) and sets `truncated` when the count is larger. Download-all and count-all then under-count a wide filter and still look successful aside from the cap flag.

## How to improve

If `truncated` is true, either fall through to the mirror crawl for the remainder or fail the job and ask for a narrower filter. Do not report the truncated length as the matched total.

## Potential gain

“Download all missing” matches the filter on large catalogues instead of stopping at the index cap.

## Evidence

- `apps/server/src/mirrors/searchOnline.ts` (lines 486–519): on a hub hit, return `hitPageCap: hub.truncated` and do not crawl mirrors.
- `apps/hub/src/services/searchIndex.ts` `querySearchIndexAll`: `truncated: total > rows.length` after `.limit(maxSets)`.

## Status

Fixed. `tryFetchAllHubCachedIds` now reports `truncatedBy` (`stop`, `request-max`, `hub-max`). When Hub's own dump cap (`hub-max`) truncated the list, `collectMatchingOnlineBeatmapsets` seeds the result from the dump and continues the live mirror crawl, deduping by set id. If the crawl still cannot cover Hub's reported total, `hitPageCap` is set so the UI shows the existing safety-cap marker instead of presenting the list as complete. A caller-imposed page cap or a cancel keeps the old behaviour (honest cap flag, no crawl). Files: `apps/server/src/mirrors/hubSearch.ts`, `apps/server/src/mirrors/searchOnline.ts`; test `apps/server/src/mirrors/searchOnline.hubTruncated.test.ts`.
