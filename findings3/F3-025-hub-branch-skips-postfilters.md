---
id: F3-025
feature: download-mirrors
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Hub-served results skip the local post-filters, so strict star operators are not enforced

## What

`stars>6` is widened to `min_stars=6` for the mirror, documented as "strict ops rely on
post-filter". The mirror branch applies that post-filter. The Hub branch applies nothing.

Hub-fetched pages therefore include 6.0-star maps that the same query excludes when the Hub
misses.

## Why

`setMatchesOnlinePostFilters` is called only in the mirror `drainPages` loop. `consume()` in
the Hub branch filters only on `seen` and `hide`. `hubCacheKeymode` treats star-only filters
as Hub-eligible precisely because the Hub re-applies them as an inclusive range.

## How to improve

Call `setMatchesOnlinePostFilters(set, postFilters)` inside `consume()` too, or pass the
strict bound to the Hub and have `secondaryWhere` honour exclusive comparisons for `stars`,
`bpm` and `length`.

## Evidence

- `apps/server/src/mirrors/onlineQuery.ts:140-141`, `:159-172`, `:252-259` - widening and the comment
- `apps/server/src/mirrors/searchOnline.ts:244-262` - no post-filter in `consume()`
- `apps/server/src/mirrors/searchOnline.ts:352` - post-filter in the mirror loop
