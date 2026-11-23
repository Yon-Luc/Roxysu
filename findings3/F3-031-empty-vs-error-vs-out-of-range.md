---
id: F3-031
feature: client-ui
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# "No results" is shown for a failed request and for an out-of-range page

## What

Two places render the empty-state copy when the request did not produce an empty match set.

`/sessions`: if the day-filter request fails, `dayItems` is `[]` and the page says "No sessions
on this day." The error is never surfaced.

Practice: `page` is persisted in storage and URL and never clamped to `totalPages`. After the
library scope narrows, the user lands on page N greater than the last page and reads "No
beatmaps match." while the header says "40 maps - page 5 / 2". Only repeated Previous clicks
recover.

## Why

The sessions day panel consults only `dayQuery.isLoading`, never `dayQuery.error`. Practice has
no effect clamping `page` to the resolved `totalPages`, and the empty branch does not
distinguish "no matches" from "page out of range", because `isPlaceholderData` is false once
the empty page resolves.

## How to improve

Surface `dayQuery.error` as danger text with a Retry before the empty branch.

In `PracticeListPage`, clamp with `useEffect` when `!isFetching`, or render a "this page is
empty - back to page 1" state that resets the page.

## Evidence

- `apps/server/public/features/sessions/SessionsPage.tsx:44-50`, `:200-209` - loading-only gate
- `apps/server/public/features/practice/PracticeListPage.tsx:203-216`, `:245-247`, `:488-495`
- `apps/server/public/lib/practiceSearch.ts:103-110` - persisted page
