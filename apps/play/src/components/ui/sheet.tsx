import React, { createContext, useContext, useMemo, useRef, isValidElement } from "react";
import { useWindowSize } from "@gpuix/react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import { FloatingLayer } from "./lib/floating";
import type { UiBaseProps } from "./lib/types";

export type SheetSide = "left" | "right" | "top" | "bottom";

interface SheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  side: SheetSide;
  triggerPressed: React.MutableRefObject<boolean>;
  dismissOutside: React.MutableRefObject<boolean>;
}

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext(name: string): SheetContextValue {
  const context = useContext(SheetContext);

  if (!context) {
    throw new Error(`${name} must be used inside <Sheet>`);
  }

  return context;
}

export interface SheetProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: SheetSide;
}

export function Sheet({ children, open, defaultOpen = false, onOpenChange, side = "right" }: SheetProps) {
  const [value, setValue] = useControllableState<boolean>({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const triggerPressed = useRef(false);
  const dismissOutside = useRef(false);

  const context = useMemo<SheetContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next), side, triggerPressed, dismissOutside }),
    [value, setValue, side, triggerPressed, dismissOutside],
  );

  return <SheetContext.Provider value={context}>{children}</SheetContext.Provider>;
}

export interface SheetTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function SheetTrigger({ asChild, children, onClick, onMouseDown, ...rest }: SheetTriggerProps) {
  const { open, setOpen, triggerPressed, dismissOutside } = useSheetContext("SheetTrigger");
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

export interface SheetContentProps extends UiBaseProps {
  side?: SheetSide;
  children?: React.ReactNode;
}

export function SheetContent({ side, style, children, testId }: SheetContentProps) {
  const { open, setOpen, side: contextSide, dismissOutside } = useSheetContext("SheetContent");
  const windowSize = useWindowSize();
  const winW = windowSize?.width ?? 820;
  const winH = windowSize?.height ?? 860;
  const resolvedSide = side ?? contextSide;

  if (!open) {
    return null;
  }

  const edge = resolvedSide === "left" || resolvedSide === "right";
  const panelSize: StyleDesc = edge
    ? { width: 340, height: winH, flexDirection: "column" as const }
    : { width: winW, height: 340, flexDirection: "column" as const };

  return (
    <FloatingLayer
      side={resolvedSide}
      align="start"
      sideOffset={0}
      tabIndex={0}
      autoFocus
      style={mergeStyles({ padding: 0, backgroundColor: "transparent", borderWidth: 0, boxShadow: undefined }, style)}
      onMouseDownOutside={(event: EventPayload) => {
        dismissOutside.current = true;
        queueMicrotask(() => {
          dismissOutside.current = false;
        });
        setOpen(false);
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
            ...panelSize,
            backgroundColor: colors.card,
            color: colors.cardForeground,
            borderWidth: 1,
            borderColor: colors.border,
            boxShadow: shadows.lg,
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

export function SheetHeader({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column", gap: 4, padding: 20 }, style)}>
      {children}
    </div>
  );
}

export function SheetTitle({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <text style={mergeStyles({ fontSize: 18, fontWeight: 700, color: colors.foreground }, style)}>
      {children}
    </text>
  );
}

export function SheetDescription({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <text style={mergeStyles({ fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }, style)}>
      {children}
    </text>
  );
}

export function SheetFooter({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", justifyContent: "flex-end", gap: 8, padding: 20, paddingTop: 0 }, style)}>
      {children}
    </div>
  );
}
