---
id: F-047
feature: practice-library
kind: design-gap
severity: medium
confidence: verified
---

# Practice library page changes drop the result grid

## What

Sort controls and the search chrome stay mounted. The result grid does not. `isLoading` replaces the grid with `CardGridSkeleton` because the query key includes `page` and the query has no `placeholderData`. The result-count line also hides, because it renders only when `list` is set.

## Why

In TanStack Query, `isLoading` is true when the new key has no data yet. Turning the page is a new key, so the previous page cannot stay on screen.

## How to improve

| Before | After |
| --- | --- |
| `isLoading` swaps the grid for a skeleton and clears the count | `placeholderData: keepPreviousData`. Dim the grid while `isFetching` |
| First visit and page change share one branch | Skeleton only when there is no previous page |

## Potential gain

Paging a large library keeps the current cards until the next page arrives.

## Evidence

- `apps/server/public/features/practice/PracticeListPage.tsx` (about lines 227–237): query key includes `page`, no `placeholderData`.
- Lines 503–517: count renders only when `list` is set; `isLoading` renders `CardGridSkeleton`.
