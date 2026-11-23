---
id: F3-012
feature: smart-collections
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# The collection match count store never refreshes after rating jobs or axis edits

## What

`GET /collections/:id/results` passes `knownTotal: col.cachedMatchCount` and skips the
`COUNT(*)`. The results page derives `totalPages` from that number.

A `dan:`, `rework:`, `axis:` or `pattern:` collection keeps its pre-job count until the next
`sync.finished` or `mastery.updated`. Pages that now have results are unreachable, and pages
that no longer have results render empty.

## Why

`startCollectionMatchCache` subscribes only to `sync.finished` and `mastery.updated`. The
rework-dan and pattern jobs publish neither. The settings PATCH for axis thresholds
invalidates only the query-context cache, not the counts - while `countMatchesPure` for
those queries does change.

## How to improve

Call `scheduleRefreshAllMatchCounts(db)`:

1. when the rework-dan and pattern jobs finish with rows written;
2. in the `axisThresholdsChanged` branch of `PATCH /api/settings`;
3. as a fallback, drop `knownTotal` in the `/results` handler when
   `col.cachedMatchCount` is older than `collections.updatedAt` or than the last import.

## Evidence

- `apps/server/src/routes/collections.ts:699-703` - `knownTotal` passed straight through
- `apps/server/src/shared/collectionMatchCache.ts:17-36`, `:119-142` - the two subscriptions
- `apps/server/src/routes/settings.ts:688-696` - axis PATCH invalidates only the context
- `apps/server/public/features/collections/CollectionResultsPage.tsx:65-67`, `:228` - `totalPages`
