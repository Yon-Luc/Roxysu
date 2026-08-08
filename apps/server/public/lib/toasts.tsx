import {
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export type ToastTone = "neutral" | "success" | "error";

export type Toast = {
  id: string;
  title: string;
  detail?: string;
  tone: ToastTone;
  /** ms; null = sticky until dismissed */
  durationMs: number | null;
  action?: { label: string; onClick: () => void };
};

type ToastInput = {
  title: string;
  detail?: string;
  tone?: ToastTone;
  durationMs?: number | null;
  action?: { label: string; onClick: () => void };
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

export function pushToast(input: ToastInput): string {
  const id = `toast-${nextId++}`;
  const toast: Toast = {
    id,
    title: input.title,
    detail: input.detail,
    tone: input.tone ?? "neutral",
    durationMs: input.durationMs === undefined ? 6_000 : input.durationMs,
    action: input.action,
  };
  toasts = [...toasts, toast];
  emit();
  return id;
}

export function dismissToast(id: string) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function toneClass(tone: ToastTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/40 bg-elevated text-ink";
    case "error":
      return "border-rose-500/40 bg-elevated text-ink";
    default:
      return "border-border bg-elevated text-ink";
  }
}

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    if (toast.durationMs == null) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.durationMs, toast.id]);

  return (
    <div
      role="status"
      className={`pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur ${toneClass(toast.tone)}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.detail ? (
            <p className="mt-0.5 text-xs text-muted">{toast.detail}</p>
          ) : null}
          {toast.action ? (
            <button
              type="button"
              className="mt-1.5 text-xs font-semibold text-accent hover:underline"
              onClick={() => {
                toast.action?.onClick();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-faint hover:text-ink"
          aria-label="Dismiss"
          onClick={() => dismissToast(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Bottom-right toast stack. Mount once in the app shell. */
export function ToastHost({
  offsetBottomClass = "bottom-20 md:bottom-4",
}: {
  offsetBottomClass?: string;
}) {
  const items = useToasts();
  if (typeof document === "undefined" || items.length === 0) return null;

  return createPortal(
    <div
      className={`pointer-events-none fixed right-4 z-60 flex flex-col-reverse gap-2 ${offsetBottomClass}`}
      aria-live="polite"
    >
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}

export function usePushToast() {
  return useCallback((input: ToastInput) => pushToast(input), []);
}
