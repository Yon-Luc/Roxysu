---
cand: D7
reopens: F-052
feature: dashboard
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# Command palette opens over other modals

## Problem

Ctrl/Cmd+K is ignored only for TEXTAREA, SELECT, and contentEditable. It does not look for an open dialog. With `ConfirmModal` open, both document listeners run: the palette's Tab trap and `focusin` pull-back, and the confirm modal's Tab trap. Neither stops propagation.

The palette is `z-[100]`. `ConfirmModal` is `z-50`. The palette paints on top and the traps fight. One Escape runs both handlers, so a pending delete confirm closes with the palette.

This is not inferred. The listeners are both on `document` and the shortcut has no modal guard. `SchemaOutdatedDialog` is `z-[200]` and uses capture-phase `stopPropagation`, so that one dialog is not this bug. `ConfirmModal` is.

## Potential solution

Do not open the palette while another modal is up. Check before toggle:

```ts
if (document.querySelector("[aria-modal='true']")) return;
```

Put that next to the TEXTAREA / SELECT guard in `useCommandPaletteShortcut`. The palette's own dialog is not mounted when the shortcut is what opens it, so the selector does not block the open. It does block open-while-confirm.

When the palette is already open, the shortcut may still toggle it closed. The selector will see the palette's own `aria-modal`. Allow close:

```ts
const otherModal = [...document.querySelectorAll("[aria-modal='true']")]
  .some((el) => el !== paletteDialog);
if (otherModal && !paletteOpen) return;
```

The hook may not have the dialog node. Simpler rule, good enough: if any `[aria-modal='true']` exists and the event target is not inside the palette, ignore the shortcut. Escape and Tab stay on the top modal. The palette does not open, so it cannot steal the confirm's Escape.

Do not build a modal stack in this change. One guard fixes the reported clash. A stack is the follow-up if a third modal needs ordered Escape.

## Do not

- Do not remove `ConfirmModal`'s trap. It is correct when it is the only dialog.
- Do not raise `ConfirmModal` above the palette instead. The palette should not be open.

## Touch

- `apps/server/public/components/CommandPalette.tsx` — `useCommandPaletteShortcut`

## Tests

The shortcut test, if one exists, gains: a mounted `[aria-modal='true']` element, dispatch Ctrl+K, palette does not open. Without that element, it still opens. No browser driver required if the hook reads `document`.
