---
id: F-046
feature: smart-collections
kind: design-gap
severity: medium
confidence: verified
---

# Collection result pages replace the whole screen while loading

## What

`CollectionResultsPage` returns a full-page skeleton whenever `isLoading` is true. Page changes use a new query key and no `placeholderData`, so each page is a pending query: title, query, export link, and grid all disappear. The success branch already dims the grid with `isFetching`, and that branch never runs during the page change.

## Why

Pagination is a local update. The early return treats it as a new screen.

## How to improve

| Before | After |
| --- | --- |
| `if (isLoading) return` full skeleton, including the title | Skeleton only when there is no payload yet. On page change, keep the header and dim the grid |
| No previous page kept | `placeholderData: keepPreviousData` on the results query |

## Potential gain

Paging a large smart collection keeps the collection name and export action in place.

## Evidence

- `apps/server/public/features/collections/CollectionResultsPage.tsx` (lines 69–87): early return skeleton.
- Same file (lines 139–141): `isFetching` opacity exists only on the success render.
