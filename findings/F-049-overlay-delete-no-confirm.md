---
id: F-049
feature: overlay-editor
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Overlay profile and layer deletes have no confirm

## What

“Delete” on the editor calls `deleteMutation.mutate(draft.id)` immediately. The layer row’s remove button calls `removeElement` with no undo.

## Why

A profile is an OBS layout. The delete control is a normal button in the editor chrome. Save errors toast; delete does not ask.

## How to improve

| Before | After |
| --- | --- |
| Profile delete fires the mutation | `ConfirmModal` naming the profile |
| Layer “×” removes at once | Undo toast, or confirm when the element has been moved or configured |

## Potential gain

A mis-click does not drop a multi-element HUD.

## Evidence

- `apps/server/public/features/overlay-editor/OverlayEditorPage.tsx` (about lines 405–411): delete button.
- Same file (about lines 490–495): `removeElement(el.instanceId)` on the layer button.

## Status

Fixed. `OverlayEditorPage.tsx`: profile Delete opens `ConfirmModal` naming the profile and its layer count, busy until the profiles refetch finishes, errors shown in the modal. Layer remove keeps working at once (it edits the unsaved draft) and pushes an 8 s Undo toast that reinserts the layer at its original position; the other option (confirm) was not used because the toast already exists in the app and the edit is reversible.
