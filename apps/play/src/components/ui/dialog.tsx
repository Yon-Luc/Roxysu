import React, { createContext, useContext, useMemo } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
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

  const context = useMemo<DialogContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next) }),
    [value, setValue],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

export interface DialogTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function DialogTrigger({ asChild, children, onClick, ...rest }: DialogTriggerProps) {
  const { open, setOpen } = useDialogContext("DialogTrigger");

  return renderSlot({
    asChild,
    children,
    props: {
      ...rest,
      onClick: (event: EventPayload) => {
        onClick?.(event);
        setOpen(!open);
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
  const { open, setOpen } = useDialogContext("DialogContent");

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
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
        onMouseDownOutside={(event: EventPayload) => {
          if (closeOnScrim) {
            setOpen(false);
          }
        }}
        testId={testId}
      >
        {children}
      </div>
    </div>
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
    <text style={mergeStyles({ fontSize: 13, color: colors.mutedForeground, lineHeight: 1.4 }, style)}>
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
