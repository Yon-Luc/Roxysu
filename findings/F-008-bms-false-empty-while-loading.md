---
id: F-008
feature: bms
kind: design-gap
severity: high
confidence: verified
---

# BMS profile says there are no scores while the request is in flight

## What

Local and public BMS pages render `BmsProfileView` before profile data exists. `plays` falls back to 0 and `scores` falls back to `[]`. The view prints “No BMS scores yet.” whenever `scores.length === 0`. Fetch errors use `text-warning`, the same tone as a soft hint.

The local page keeps previous data across variant changes (`placeholderData`). The first load, and the public player page (no placeholder), still show the empty copy.

## Why

Empty copy is tied to the array length, not to query status. A slow disk or Hub round-trip looks like an empty profile.

## How to improve

| Before | After |
| --- | --- |
| `plays ?? 0` and “No BMS scores yet.” whenever the score list is empty | Pass `isLoading`. Show skeletons and hide empty copy until the profile query settles |
| Errors in `text-warning` | `text-danger` for a failed load |

## Potential gain

A player with BMS scores does not see a false empty profile on open. A failed load is visibly a failure.

## Evidence

- `apps/server/public/features/bms/BmsLocalPage.tsx` (lines 31–47): `plays={profile.data?.plays ?? 0}`, `scores={profile.data?.recent ?? []}`.
- `apps/server/public/features/bms/BmsPlayerPage.tsx` (lines 34–37 and 93–97): public profile query has no `placeholderData`; same fallbacks.
- `apps/server/public/features/bms/BmsProfileView.tsx` (about lines 200 and 247–248): warning-colored error, empty copy when `scores.length === 0`.
