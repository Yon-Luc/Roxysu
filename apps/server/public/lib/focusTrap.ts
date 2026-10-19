/**
 * Pure Tab-cycle helper for modal dialogs.
 *
 * Returns the element that should receive focus when Tab (or Shift+Tab) is
 * pressed inside a trapped dialog, or `null` when the browser's default move
 * stays inside the dialog and must not be prevented.
 */
export function focusTrapTarget<T>(
  focusables: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const index = active == null ? -1 : focusables.indexOf(active);
  // Focus is outside the dialog: pull it back in at the matching edge.
  if (index === -1) return shiftKey ? last : first;
  if (shiftKey && index === 0) return last;
  if (!shiftKey && index === focusables.length - 1) return first;
  return null;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Tabbable descendants of `root`, in DOM order. */
export function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}
