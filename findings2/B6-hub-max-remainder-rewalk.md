---
cand: B6
reopens: F-025
feature: download-mirrors
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Hub-max remainder crawl re-walks the pages Hub already supplied

## Problem

F-025 was right to keep crawling after a Hub dump truncated at its own cap. The crawl starts at mirror page 0.

`truncatedBy === "hub-max"` only when the Hub request asked for the full 100,000 sets (`requestedMax < HUB_SEARCH_ALL_MAX_SETS` is `request-max` and does not crawl). Download-all uses that cap: `MAX_QUERY_SETS` and `MAX_QUERY_PAGES` are 100,000 and 1,000. `MIRROR_PAGE_CAPACITY` is 100. The first 1,000 mirror pages are the sets Hub already returned, if the mirror sort matches Hub's stored order. `seen` drops them. The pages past the dump are never requested. `hitPageCap` is not set for that case unless the union is still short of `hubSeed.total` after the wasted walk.

This is not dead at the batch defaults. It is dead at `collectMatchingOnlineBeatmapsets`'s own default of 200 pages / 10,000 sets, because that request is `request-max` and returns before the crawl. The F-025 tests pass `maxPages: 1000`, and Hub's request size is `maxPages * 100`, so those tests do enter the crawl. They use a handful of ids, so page 0 is the right start. A seek must not break them.

Sort equality is not checked. Hub stores `position`. Sort is forwarded. A blind `floor(seen.size / 100)` can skip unseen sets if the orders differ.

## Potential solution

Seek only for a hub-max seed that already covers at least one full mirror page. Validate one page before trusting the skip.

```ts
let mirrorPage = 0;
if (hubSeed && hubSeed.seen.size >= MIRROR_PAGE_CAPACITY) {
  const prefixPages = Math.floor(hubSeed.seen.size / MIRROR_PAGE_CAPACITY);
  const tail = await fetchMirrorPage(prefixPages - 1);
  const tailIds = tail.map((set) => set.id);
  if (tailIds.length === 0 || tailIds.some((id) => !hubSeed.seen.has(id))) {
    // Orders do not match. Walking from 0 cannot pass 100k inside the page cap.
    hitPageCap = true;
    mirrorHasMore = false;
  } else {
    mirrorPage = prefixPages;
  }
}
```

Then the existing loop starts at `mirrorPage` instead of 0. Dedupe via `seen` still covers a partial last page (`floor`, not `ceil`: a 100,050 dump starts at page 1,000, which still holds the last 50 seen ids).

If validation fails, return `hitPageCap: true` with the Hub sets already collected. Download-all already surfaces `hitCap`. That is the "narrow the filter" outcome. Do not fall back to walking from 0. Those 1,000 requests cannot reach the remainder either.

Seeds smaller than 100 ids, including the current F-025 fixtures, stay on page 0.

## Do not

- Do not delete the remainder crawl. A matching sort can still supply sets past 100,000. F-025's "truncated is not complete" rule stays.
- Do not raise `COUNT_MAX_PAGES` to walk the prefix. That is the wasted work.
- Do not seek on `request-max`. That path must keep returning without a mirror crawl.

## Touch

- `apps/server/src/mirrors/searchOnline.ts` — the `for (let mirrorPage = 0; ...)` loop after a hub seed
- `apps/server/src/mirrors/searchOnline.hubTruncated.test.ts`

## Tests

- Existing five-id fixture still fetches mirror page 0 and still dedupes.
- Hub seed of 200 ids, remainder on mirror page 2: page 0 is not fetched; page 1 is the validation fetch; page 2 is crawled; new ids are kept.
- Validation page contains an id not in the seed: `hitPageCap` is true, no further mirror pages, seed ids are still returned.
