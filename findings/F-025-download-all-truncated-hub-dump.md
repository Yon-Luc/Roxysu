---
id: F-025
feature: download-mirrors
kind: correctness
severity: medium
confidence: verified
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
