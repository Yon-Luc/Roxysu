---
id: F-050
feature: overlay-editor
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Overlay editor offers “create profile” while profiles are still loading

## What

`profiles` defaults to `[]` when the query has no data. The canvas branch shows “No overlay profile yet.” and a create button whenever `draft` is null. That is also the state while `profilesQuery` is loading.

## Why

A returning user can create a second profile during the load, because the empty state and the loading state are the same render.

## How to improve

| Before | After |
| --- | --- |
| `profiles ?? []`, then the create call-to-action when `draft` is null | Spinner while `profilesQuery.isLoading`. Create call-to-action only after a successful empty list |
| No error surface | Inline error and retry on `profilesQuery.error` |

## Potential gain

Opening the editor does not invite a duplicate profile.

## Evidence

- `apps/server/public/features/overlay-editor/OverlayEditorPage.tsx` (lines 102–106): `profilesQuery.data?.profiles ?? []`.
- Lines 328–338: “No overlay profile yet.” and `makeProfile("New overlay")` with no `isLoading` check.

## Status

Fixed. `OverlayEditorPage.tsx` shows a spinner while `profilesQuery.isLoading`, an inline error with Retry on `profilesQuery.isError`, and the create call-to-action only after a successful empty list. The button is disabled while a save or refetch is in flight.
