---
id: F3-032
feature: client-ui
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# The mobile "More" sheet declares itself a modal but manages no focus

## What

Opening the bottom-sheet More menu on a narrow viewport leaves focus on the More button with no
initial focus, no Tab trap and no focus restore. The sheet sits before that button in the DOM,
so Tab from the button leaves the menu entirely while `aria-modal="true"` tells assistive tech
that nothing else exists.

It also suppresses Ctrl+K, because the palette's guard sees an `[aria-modal]` and the target is
outside the palette - so search is dead while the sheet is open.

## Why

`AppShell` renders the sheet inline with only an Escape handler. It does not reuse
`lib/focusTrap.ts` the way `ConfirmModal`, `GenerateCollectionsModal` and `CommandPalette` do.

## How to improve

On open: focus the sheet container (`tabIndex={-1}`) or the Close button, install the same Tab
and `focusin` trap the palette uses, and restore focus to the More button on close.

## Evidence

- `apps/server/public/components/AppShell.tsx:505-558` - the sheet
- `apps/server/public/components/AppShell.tsx:578-592` - the More button
- `apps/server/public/components/CommandPalette.tsx:252-275` - the trap to copy
- `apps/server/public/components/ConfirmModal.tsx:33-72` - the same pattern

## Notes

D7 (palette over modals) is closed. This dialog was never covered by it.
