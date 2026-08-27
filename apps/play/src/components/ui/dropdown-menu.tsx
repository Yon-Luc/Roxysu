import React, { createContext, useContext, useMemo, useRef, isValidElement } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import { FloatingLayer } from "./lib/floating";
import type { UiBaseProps } from "./lib/types";

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerPressed: React.MutableRefObject<boolean>;
  dismissOutside: React.MutableRefObject<boolean>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(name: string): MenuContextValue {
  const context = useContext(MenuContext);

  if (!context) {
    throw new Error(`${name} must be used inside <DropdownMenu>`);
  }

  return context;
}

/** Shared menu item style (used by DropdownMenu and ContextMenu). */
export function menuItemStyle(active?: boolean, disabled?: boolean): StyleDesc {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    height: 34,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    borderRadius: radius.sm,
    color: colors.foreground,
    fontSize: 13,
    cursor: disabled ? "default" : "pointer",
    userSelect: "none",
    backgroundColor: active ? colors.secondary : "transparent",
    opacity: disabled ? 0.5 : 1,
  };
}

export interface DropdownMenuProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({ children, open, defaultOpen = false, onOpenChange }: DropdownMenuProps) {
  const [value, setValue] = useControllableState<boolean>({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const triggerPressed = useRef(false);
  const dismissOutside = useRef(false);

  const context = useMemo<MenuContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next), triggerPressed, dismissOutside }),
    [value, setValue, triggerPressed, dismissOutside],
  );

  return <MenuContext.Provider value={context}>{children}</MenuContext.Provider>;
}

export interface DropdownMenuTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function DropdownMenuTrigger({ asChild, children, onClick, onMouseDown, ...rest }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerPressed, dismissOutside } = useMenuContext("DropdownMenuTrigger");
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

export interface DropdownMenuContentProps extends UiBaseProps {
  children?: React.ReactNode;
}

export function DropdownMenuContent({ style, children, ...rest }: DropdownMenuContentProps) {
  const { open, setOpen, dismissOutside } = useMenuContext("DropdownMenuContent");

  if (!open) {
    return null;
  }

  return (
    <FloatingLayer
      side="bottom"
      align="start"
      sideOffset={6}
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

export interface DropdownMenuItemProps extends UiBaseProps {
  asChild?: boolean;
  disabled?: boolean;
  onSelect?: (event: EventPayload) => void;
  children?: React.ReactNode;
}

export function DropdownMenuItem({ asChild, disabled, onSelect, onClick, children, style }: DropdownMenuItemProps) {
  const { setOpen, dismissOutside } = useMenuContext("DropdownMenuItem");
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

export function DropdownMenuLabel({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
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

export function DropdownMenuSeparator({ style }: { style?: StyleDesc }) {
  return <div style={mergeStyles({ height: 1, backgroundColor: colors.border, margin: spacing.xs }, style)} />;
}
