---
cand: D6
reopens: F-044
feature: bms
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# Public BMS tables tab shows a false empty state and hides errors

## Problem

F-044 now fetches every catalogue table. The tab still lies while that fetch is in flight.

`tablesPending` is `tableQueries.some(isPending)`. `tableQueries` is built from `catalogue.data?.tables ?? []`. Until the catalogue resolves, that array is empty, `[].some(...)` is false, and `tablesPending` is false. `BmsProfileView` then renders `BmsTableBrowser`, which shows "No difficulty table is available."

Catalogue and per-table errors never reach the `error` prop. That prop is profile, else scores. On the tables tab the scores query is disabled, so a failed table fetch also falls through to the empty sentence.

While the catalogue has loaded and the table queries are actually pending, the section is omitted entirely. That is a missing skeleton, not the empty sentence.

## Potential solution

Pending means the catalogue is in flight, or at least one table query is in flight and none have data yet.

```ts
tablesPending={
  view === "tables" &&
  (catalogue.isPending ||
    (tableQueries.some((query) => query.isPending) &&
      tableQueries.every((query) => !query.data)))
}
```

Errors, in this order, still on the tables tab only for catalogue and table failures so a scores error does not cover the tables view:

```ts
const tableError = tableQueries.find((query) => query.error instanceof Error)?.error;
error={
  hidden ? privateCopy
  : profile.error instanceof Error ? profile.error.message
  : view === "tables" && catalogue.error instanceof Error ? catalogue.error.message
  : view === "tables" && tableError instanceof Error ? tableError.message
  : scores.error instanceof Error ? scores.error.message
  : null
}
```

`BmsProfileView` / `BmsTableBrowser` already hide the empty copy when `tablesPending` is true, and they already render `error`. No new empty-state component. If the profile view has no retry on that error string, pass the same Retry the other BMS error panels use. Do not invent a second empty sentence.

## Do not

- Do not treat an empty catalogue after a successful fetch as pending. That really is no tables. Only `isPending` and `isError` change the copy.
- Do not go back to fetching the first table only. That was F-044.

## Touch

- `apps/server/public/features/bms/BmsPlayerPage.tsx` — `tablesPending` and `error`

## Tests

A render test with catalogue `isPending` and no table queries: the empty sentence is absent, the pending state is present. Catalogue `isError`: the error message is present, the empty sentence is absent. Catalogue success with one table still renders that table.
