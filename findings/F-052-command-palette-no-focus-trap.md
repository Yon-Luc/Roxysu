---
id: F-052
feature: dashboard
kind: design-gap
severity: medium
confidence: verified
status: fixed
---

# Command palette is a modal that does not trap focus

## What

The palette sets `role="dialog"` and `aria-modal`, focuses the input, locks body scroll, and handles Escape, arrows, and Enter. Tab is not cycled inside the dialog. Focus is not restored to the trigger on close.

## Why

`ConfirmModal` already traps focus. The palette is the primary jump surface. Tab from the input moves into the page behind the scrim.

## How to improve

| Before | After |
| --- | --- |
| Focus the input on open only | Trap Tab between the input and the result buttons. Restore focus on close |
| Scroll lock on `body` | `inert` on the rest of the page while the dialog is open |

## Potential gain

Keyboard users stay in the palette until they dismiss it.

## Evidence

- `apps/server/public/components/CommandPalette.tsx` (lines 242–254): focus and overflow only.
- Lines 493–497: `role="dialog"` `aria-modal="true"`. No Tab handler in the file.

## Status

Fixed. `CommandPalette.tsx` saves `document.activeElement` on open and restores it on close, traps Tab / Shift+Tab inside the dialog via the new pure helper `lib/focusTrap.ts` (`focusTrapTarget`, `listFocusable`, tested in `focusTrap.test.ts`), pulls focus back on `focusin` outside the dialog, and syncs the active row on button focus. `inert` on the page behind was not added: the palette mounts inside `AppShell`, so the focus trap plus the `focusin` guard cover keyboard and assistive-technology escape without touching the shell. Note: `ConfirmModal` does not itself trap Tab (the finding assumed it did).
