import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { EventPayload } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { FloatingLayer } from "./lib/floating";

type ToastVariant = "default" | "destructive" | "success";

interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }

  return context;
}

let toastCounter = 0;

export interface ToastProviderProps {
  children?: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++toastCounter;
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? "default",
        duration: options.duration ?? 4000,
      };

      setToasts((current) => [...current, item]);

      if (item.duration > 0) {
        setTimeout(() => dismiss(id), item.duration);
      }

      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const toastVariantTokens: Record<ToastVariant, { border: string }> = {
  default: { border: colors.border },
  destructive: { border: colors.destructive },
  success: { border: colors.success },
};

export interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/** Floating toast stack anchored to its previous sibling (bottom-right). */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <FloatingLayer
      side="bottom"
      align="end"
      sideOffset={16}
      occlude={false}
      style={{ padding: 0, backgroundColor: "transparent", borderWidth: 0, boxShadow: undefined }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm, maxWidth: 320 }}>
        {toasts.map((item) => {
          const tokens = toastVariantTokens[item.variant];

          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: spacing.md,
                backgroundColor: colors.card,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: tokens.border,
                boxShadow: shadows.md,
              }}
            >
              {item.title ? (
                <text style={{ fontSize: 14, fontWeight: 600, color: colors.foreground, lineHeight: 18 }}>
                  {item.title}
                </text>
              ) : null}
              {item.description ? (
                <text style={{ fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }}>
                  {item.description}
                </text>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  onClick={() => onDismiss(item.id)}
                  style={{ fontSize: 12, color: colors.primary, cursor: "pointer", userSelect: "none" }}
                >
                  Dismiss
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </FloatingLayer>
  );
}

export type { ToastOptions };
