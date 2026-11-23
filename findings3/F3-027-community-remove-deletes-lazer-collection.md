---
id: F3-027
feature: client-ui
kind: design-gap
severity: medium
confidence: verified
status: proposed
---

# Removing a Community collection deletes the lazer collection on one click

## What

In Community -> "Collections added", the card button "Remove from collection" immediately
unlinks the collection and re-syncs Realm, deleting the `!Roxysu ...` collection inside
osu!lazer. There is no confirm and no undo, so a misclick destroys the in-game collection the
user built.

## Why

`HubBrowsePage` wires `onRemove={() => removeMut.mutate(c.id)}` straight to the mutation, and
the server handler then calls `syncCollectionsToLazer`, which removes the managed Realm
collection. Every other destructive surface was hardened (F-048 confirm, F-049 undo); this
one was missed.

## How to improve

Wrap it in `ConfirmModal` exactly as the Collections page does, keeping the busy state
through the refetch. Or keep a pre-delete snapshot and offer an 8 s Undo that re-posts
`saveHubAddedCollection`.

Because this touches Realm, prefer confirm over undo: the write-back is gated on lazer being
closed, and an undo may not be able to run.

## Evidence

- `apps/server/public/features/hub/HubBrowsePage.tsx:140-160`, `:422-424` - direct mutate on click
- `apps/server/public/components/HubCollectionCard.tsx:168-181` - the button
- `apps/server/src/routes/collections.ts:262-290` - unlink then `syncCollectionsToLazer`
- `apps/server/public/features/collections/CollectionsPage.tsx:432-454` - the pattern to copy
- `knowledge/business/collection-lazer-sync.md` - write-back gating
