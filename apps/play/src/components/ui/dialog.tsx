import React, { createContext, useContext, useMemo, useRef, isValidElement } from "react";
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
  const asChildResolved = asChild ?? (isValidElement(children) ? true : false);

  return renderSlot({
    asChild: asChildResolved,
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

export type DialogSize = "default" | "sm" | "lg" | "fullscreen";

export interface DialogContentProps extends UiBaseProps {
  closeOnScrim?: boolean;
  size?: DialogSize;
  children?: React.ReactNode;
}

/**
 * Full-window positioning surface. The anchored `FloatingLayer` here is used as
 * a centered viewport (not an anchored popover): it stretches to the window and
 * centers its children. `onMouseDownOutside` still closes when a click lands
 * outside the anchored region, while scrim clicks are handled by `DialogBackdrop`.
 */
function DialogViewport({
  children,
  onMouseDownOutside,
  onKeyDown,
}: {
  children: React.ReactNode;
  onMouseDownOutside: (event: EventPayload) => void;
  onKeyDown: (event: EventPayload) => void;
}) {
  return (
    <FloatingLayer
      side="bottom"
      align="center"
      sideOffset={0}
      tabIndex={0}
      autoFocus
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        backgroundColor: "transparent",
        borderWidth: 0,
        boxShadow: undefined,
      }}
      onMouseDownOutside={onMouseDownOutside}
      onKeyDown={onKeyDown}
    >
      {children}
    </FloatingLayer>
  );
}

/**
 * Dimmed scrim behind the modal surface. Kept as its own primitive so a future
 * `blurred` variant can become an implementation detail here without changing the
 * dialog's internal structure.
 */
function DialogBackdrop({ onMouseDown }: { onMouseDown?: (event: EventPayload) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.55)",
      }}
    />
  );
}

/** The modal surface itself — a normal opaque/translucent card, never the blur layer. */
function DialogSurface({
  size,
  style,
  testId,
  children,
}: {
  size: DialogSize;
  style?: StyleDesc;
  testId?: string;
  children?: React.ReactNode;
}) {
  const surfaceStyle: StyleDesc =
    size === "fullscreen"
      ? {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
          borderWidth: 0,
          backgroundColor: colors.background,
        }
      : {
          position: "relative",
          display: "flex",
          flexDirection: "column",
          backgroundColor: colors.card,
          color: colors.cardForeground,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: shadows.lg,
          minWidth: size === "sm" ? 320 : 420,
          maxWidth: size === "lg" ? 720 : 520,
          maxHeight: "90%",
          overflow: "hidden",
        };

  return (
    <div testId={testId} style={mergeStyles(surfaceStyle, style)}>
      {children}
    </div>
  );
}

export function DialogContent({
  closeOnScrim = true,
  size = "default",
  style,
  children,
  testId,
}: DialogContentProps) {
  const { open, setOpen, dismissOutside } = useDialogContext("DialogContent");
  const fullscreen = size === "fullscreen";

  if (!open) {
    return null;
  }

  const outside = (event: EventPayload) => {
    if (!closeOnScrim) {
      return;
    }

    dismissOutside.current = true;

    queueMicrotask(() => {
      dismissOutside.current = false;
    });

    setOpen(false);
  };

  const onKey = (event: EventPayload) => {
    if (event.key === "escape") {
      setOpen(false);
    }
  };

  return (
    <DialogViewport onMouseDownOutside={outside} onKeyDown={onKey}>
      {!fullscreen && <DialogBackdrop onMouseDown={closeOnScrim ? outside : undefined} />}
      <DialogSurface size={size} style={style} testId={testId}>
        {children}
      </DialogSurface>
    </DialogViewport>
  );
}

export function DialogHeader({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column", gap: 4, padding: 20 }, style)}>
      {children}
    </div>
  );
}

export function DialogBody({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div
      style={mergeStyles(
        { display: "flex", flexDirection: "column", gap: 4, padding: 20, paddingTop: 0, flexGrow: 1, minHeight: 0, overflow: "auto" },
        style,
      )}
    >
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
