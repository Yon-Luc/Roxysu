---
id: F-052
feature: dashboard
kind: design-gap
severity: medium
confidence: verified
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
