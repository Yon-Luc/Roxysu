import React, { createContext, useContext, useMemo, useRef, isValidElement } from "react";
import { useGpuix } from "@gpuix/react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import { FloatingLayer } from "./lib/floating";
import { menuItemStyle } from "./dropdown-menu";
import type { UiBaseProps } from "./lib/types";

interface ContextMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerPressed: React.MutableRefObject<boolean>;
  dismissOutside: React.MutableRefObject<boolean>;
  anchorOffset: React.MutableRefObject<{ x: number; y: number } | null>;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

function useContextMenuContext(name: string): ContextMenuContextValue {
  const context = useContext(ContextMenuContext);

  if (!context) {
    throw new Error(`${name} must be used inside <ContextMenu>`);
  }

  return context;
}

export interface ContextMenuProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ContextMenu({ children, open, defaultOpen = false, onOpenChange }: ContextMenuProps) {
  const [value, setValue] = useControllableState<boolean>({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const triggerPressed = useRef(false);
  const dismissOutside = useRef(false);
  const anchorOffset = useRef<{ x: number; y: number } | null>(null);

  const context = useMemo<ContextMenuContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next), triggerPressed, dismissOutside, anchorOffset }),
    [value, setValue, triggerPressed, dismissOutside, anchorOffset],
  );

  return <ContextMenuContext.Provider value={context}>{children}</ContextMenuContext.Provider>;
}

export interface ContextMenuTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function ContextMenuTrigger({ asChild, children, onClick, onMouseDown, onContextMenu, ...rest }: ContextMenuTriggerProps) {
  const { open, setOpen, triggerPressed, dismissOutside, anchorOffset } = useContextMenuContext("ContextMenuTrigger");
  const { renderer } = useGpuix();
  const asChildResolved = asChild ?? (isValidElement(children) ? true : false);

  const captureCursor = (event: EventPayload) => {
    const bounds = (renderer as { getElementBounds?: (id: number) => number[] | null } | null)?.getElementBounds?.(
      event.elementId,
    );
    if (bounds && bounds.length >= 4 && typeof event.x === "number" && typeof event.y === "number") {
      anchorOffset.current = { x: event.x - bounds[0], y: event.y - (bounds[1] + bounds[3]) };
    } else {
      anchorOffset.current = null;
    }
  };

  return renderSlot({
    asChild: asChildResolved,
    children,
    props: {
      ...rest,
      cursor: "context-menu",
      onMouseDown: (event: EventPayload) => {
        onMouseDown?.(event);
        triggerPressed.current = open;
      },
      onContextMenu: (event: EventPayload) => {
        onContextMenu?.(event);
        captureCursor(event);
        setOpen(true);
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
          captureCursor(event);
          setOpen(true);
        }
      },
    },
  });
}

export interface ContextMenuContentProps extends UiBaseProps {
  children?: React.ReactNode;
}

export function ContextMenuContent({ style, children, ...rest }: ContextMenuContentProps) {
  const { open, setOpen, dismissOutside, anchorOffset } = useContextMenuContext("ContextMenuContent");

  if (!open) {
    return null;
  }

  return (
    <FloatingLayer
      side="bottom"
      align="start"
      sideOffset={0}
      offset={anchorOffset.current ?? undefined}
      tabIndex={0}
      autoFocus
      style={mergeStyles({ minWidth: 200, padding: spacing.xs }, style)}
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
      {...rest}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </FloatingLayer>
  );
}

export interface ContextMenuItemProps extends UiBaseProps {
  asChild?: boolean;
  disabled?: boolean;
  onSelect?: (event: EventPayload) => void;
  children?: React.ReactNode;
}

export function ContextMenuItem({ asChild, disabled, onSelect, onClick, children, style }: ContextMenuItemProps) {
  const { setOpen, dismissOutside } = useContextMenuContext("ContextMenuItem");
  const asChildResolved = asChild ?? (isValidElement(children) ? true : false);

  return renderSlot({
    asChild: asChildResolved,
    children,
    props: {
      style: mergeStyles(menuItemStyle(false, disabled), style),
      onClick: (event: EventPayload) => {
        onClick?.(event);
        if (disabled) {
          return;
        }
        onSelect?.(event);
        dismissOutside.current = true;
        queueMicrotask(() => {
          dismissOutside.current = false;
        });
        setOpen(false);
      },
    },
  });
}

export function ContextMenuLabel({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <text
      style={mergeStyles(
        { fontSize: 11, fontWeight: 600, color: colors.mutedForeground, paddingLeft: spacing.sm, paddingTop: 4, paddingBottom: 4 },
        style,
      )}
    >
      {children}
    </text>
  );
}

export function ContextMenuSeparator({ style }: { style?: StyleDesc }) {
  return <div style={mergeStyles({ height: 1, backgroundColor: colors.border, margin: spacing.xs }, style)} />;
}
