import { useEffect, useId, useRef, type ReactNode } from "react";
import { focusTrapTarget, listFocusable } from "../lib/focusTrap";

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Callers pass inline closures; keep them in refs so a re-render does not
  // re-run the effect and lose the element that must regain focus on close.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const dialog = dialogRef.current;
        const focusables = listFocusable(dialog);
        const active = document.activeElement as HTMLElement | null;
        // The dialog container itself is focused on open; treat it as outside
        // the cycle so Tab lands on the first control.
        const target = focusTrapTarget(
          focusables,
          active === dialog ? null : active,
          e.shiftKey,
        );
        if (target) {
          e.preventDefault();
          target.focus();
        } else if (focusables.length === 0) {
          e.preventDefault();
          dialog.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            {title}
          </h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-muted">{children}</div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-5 py-4">
          <button
            type="button"
            className="rx-btn"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="rx-btn-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
