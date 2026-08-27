import React, { createContext, useContext, useMemo, useRef } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import { FloatingLayer } from "./lib/floating";
import type { UiBaseProps } from "./lib/types";

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerPressed: React.MutableRefObject<boolean>;
  dismissOutside: React.MutableRefObject<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(name: string): DialogContextValue {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error(`${name} must be used inside <Dialog>`);
  }

  return context;
}

export interface DialogProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({ children, open, defaultOpen = false, onOpenChange }: DialogProps) {
  const [value, setValue] = useControllableState<boolean>({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const triggerPressed = useRef(false);
  const dismissOutside = useRef(false);

  const context = useMemo<DialogContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next), triggerPressed, dismissOutside }),
    [value, setValue, triggerPressed, dismissOutside],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

export interface DialogTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function DialogTrigger({ asChild, children, onClick, onMouseDown, ...rest }: DialogTriggerProps) {
  const { open, setOpen, triggerPressed, dismissOutside } = useDialogContext("DialogTrigger");

  return renderSlot({
    asChild,
    children,
    props: {
      ...rest,
      onMouseDown: (event: EventPayload) => {
        onMouseDown?.(event);
        triggerPressed.current = open;
      },
      onClick: (event: EventPayload) => {
        onClick?.(event);
        if (dismissOutside.current) {
          dismissOutside.current = false;
          return;
        }
        if (triggerPressed.current) {
          triggerPressed.current = false;
          setOpen(false);
        } else {
          setOpen(true);
        }
      },
    },
  });
}

export interface DialogContentProps extends UiBaseProps {
  closeOnScrim?: boolean;
  children?: React.ReactNode;
}

export function DialogContent({
  closeOnScrim = true,
  style,
  children,
  testId,
}: DialogContentProps) {
  const { open, setOpen, dismissOutside } = useDialogContext("DialogContent");

  if (!open) {
    return null;
  }

  return (
    <FloatingLayer
      side="bottom"
      align="center"
      sideOffset={12}
      tabIndex={0}
      autoFocus
      style={mergeStyles(
        {
          backgroundColor: "transparent",
          borderWidth: 0,
          borderRadius: 0,
          padding: 0,
          boxShadow: undefined,
        },
        style,
      )}
      onMouseDownOutside={(event: EventPayload) => {
        if (closeOnScrim) {
          dismissOutside.current = true;
          queueMicrotask(() => {
            dismissOutside.current = false;
          });
          setOpen(false);
        }
      }}
      onKeyDown={(event: EventPayload) => {
        if (event.key === "escape") {
          setOpen(false);
        }
      }}
    >
      <div
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            backgroundColor: colors.card,
            color: colors.cardForeground,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            boxShadow: shadows.lg,
            minWidth: 320,
            maxWidth: 520,
            maxHeight: "90%",
            overflow: "hidden",
          },
          style,
        )}
        testId={testId}
      >
        {children}
      </div>
    </FloatingLayer>
  );
}

export function DialogHeader({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column", gap: 4, padding: 20 }, style)}>
      {children}
    </div>
  );
}

export function DialogTitle({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <text style={mergeStyles({ fontSize: 18, fontWeight: 700, color: colors.foreground }, style)}>
      {children}
    </text>
  );
}

export function DialogDescription({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <text style={mergeStyles({ fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }, style)}>
      {children}
    </text>
  );
}

export function DialogFooter({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", justifyContent: "flex-end", gap: 8, padding: 20, paddingTop: 0 }, style)}>
      {children}
    </div>
  );
}
