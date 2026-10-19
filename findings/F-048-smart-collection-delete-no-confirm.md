---
id: F-048
feature: smart-collections
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Deleting a smart collection does not ask for confirmation

## What

The collection list deletes on one click of the text button. Hub collection delete uses `ConfirmModal` with body copy that names the collection.

## Why

The control sits next to Edit and Share. The smart-collection row is the user’s definition; the click is not recoverable from the UI.

## How to improve

| Before | After |
| --- | --- |
| `onClick={() => deleteMut.mutate(c.id)}` | Open `ConfirmModal`, name the collection, confirm in `text-danger` |
| Button opacity while the mutation runs | Modal busy state until the row is gone |

## Potential gain

The same destructive bar as Community collections. Fewer accidental deletes.

## Evidence

- `apps/server/public/features/collections/CollectionsPage.tsx` (about lines 347–356): direct `deleteMut.mutate(c.id)`.
- Hub detail uses `ConfirmModal` (about lines 942–958 in `HubDetailPage.tsx`).

## Status

Fixed. `CollectionsPage.tsx` Delete opens `ConfirmModal` naming the collection (new i18n keys `collection.deleteTitle` / `collection.deleteBody` in en/es/fr/pt). The modal stays busy until the delete and the collections refetch complete; errors show inside the modal.
