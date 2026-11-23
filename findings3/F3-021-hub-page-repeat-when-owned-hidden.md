---
id: F3-021
feature: download-mirrors
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# Download Maps repeats results across pages when owned maps are hidden

## What

The Hub-served branch of Download Maps fills a UI page by walking forward from Hub page N,
but a later request for page N+1 restarts at Hub page N+1. Any page that spilled into the
next Hub page because `excludeOwned` hid rows is re-shown, and the spilled tail is never
skipped. Items repeat and other items become unreachable.

## Why

`searchOnlineBeatmapsets` has two page models. The mirror branch converts the page to a match
offset (`skipMatches = page * MIRROR_PAGE_CAPACITY`). The Hub branch passes `page` straight to
`/search` and then over-consumes later Hub pages to top the page up. Page size and Hub page
size are both 100, so one hidden row in page N shifts everything after it.

## How to improve

In the Hub branch, compute a Hub offset in matches: page through from Hub page 0 and skip
`page * MIRROR_PAGE_CAPACITY` surviving sets, reusing the `matchIndex`/`skipMatches` logic
from the mirror branch. Alternatively subtract the hidden count observed on earlier pages
from the Hub page cursor and remember it per query.

## Evidence

- `apps/server/src/mirrors/searchOnline.ts:231-295` - Hub consume and top-up
- `apps/server/src/mirrors/searchOnline.ts:302`, `:360-364` - mirror `skipMatches`
- `apps/server/src/mirrors/searchOnline.ts:239` - page passed raw to the Hub
