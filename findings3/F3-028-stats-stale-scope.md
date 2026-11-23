---
id: F3-028
feature: client-ui
kind: design-gap
severity: medium
confidence: verified
status: proposed
---

# Stats shows the previous keymode's numbers under the new keymode header

## What

Switching 4K to 7K, Top 10 to Top 50, or Day to Week leaves every figure - score and session
cards, rank distribution, skillset mix, weekly bars, skill history - on the previous scope,
while the toggle, the `keyCount` in the page hint and the "N of {{topPlays}} plays" label
already describe the new one. Nothing dims, nothing says "updating".

Worse, clicking a rank bar in that window opens Beatmaps with `key=<new>` and a `grade:`
filter from a distribution that counted `<old>`, so the bar's count and the resulting list
disagree.

## Why

The stats query uses `placeholderData: keepPreviousData` but never reads
`isFetching`/`isPlaceholderData`. `isLoading` is false whenever placeholder data exists, so
the page renders a stale payload as if current. The rank-bar handler takes `keyCount` from
props rather than from the payload it is displaying.

## How to improve

Destructure `isFetching` and apply the practice treatment: dim the stat grid and chart
sections with `aria-busy` while fetching.

For the rank bars, either disable the click while the shown payload's keymode differs from the
prop, or include the resolved key count in the `/api/stats` payload and read it from there.

## Evidence

- `apps/server/public/features/stats/StatsPage.tsx:170-182` - `keepPreviousData`, no `isFetching`
- `apps/server/public/features/stats/StatsPage.tsx:402-408`, `:450` - hint and label read the new scope
- `apps/server/public/features/stats/StatsPage.tsx:819-860` - rank-bar handler uses the prop
- `apps/server/public/features/practice/PracticeListPage.tsx:499-500` - the treatment to copy

## Notes

Same class as F-046/F-047, which fixed Practice and collection results only.
