import React, { createContext, useContext, useMemo, useRef } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";
import { FloatingLayer } from "./lib/floating";
import type { UiBaseProps } from "./lib/types";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerPressed: React.MutableRefObject<boolean>;
  dismissOutside: React.MutableRefObject<boolean>;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(name: string): PopoverContextValue {
  const context = useContext(PopoverContext);

  if (!context) {
    throw new Error(`${name} must be used inside <Popover>`);
  }

  return context;
}

export interface PopoverProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ children, open, defaultOpen = false, onOpenChange }: PopoverProps) {
  const [value, setValue] = useControllableState<boolean>({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const triggerPressed = useRef(false);
  const dismissOutside = useRef(false);

  const context = useMemo<PopoverContextValue>(
    () => ({ open: value, setOpen: (next) => setValue(next), triggerPressed, dismissOutside }),
    [value, setValue, triggerPressed, dismissOutside],
  );

  return (
    <PopoverContext.Provider value={context}>
      <div style={{ display: "flex", position: "relative", alignItems: "start" }}>{children}</div>
    </PopoverContext.Provider>
  );
}

export interface PopoverTriggerProps extends UiBaseProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function PopoverTrigger({ asChild, children, onClick, onMouseDown, ...rest }: PopoverTriggerProps) {
  const { open, setOpen, triggerPressed, dismissOutside } = usePopoverContext("PopoverTrigger");

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

export interface PopoverContentProps extends UiBaseProps {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  children?: React.ReactNode;
}

export function PopoverContent({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  style,
  children,
  onMouseDownOutside,
  onKeyDown,
}: PopoverContentProps) {
  const { open, setOpen, dismissOutside } = usePopoverContext("PopoverContent");

  if (!open) {
    return null;
  }

  return (
    <FloatingLayer
      side={side}
      align={align}
      sideOffset={sideOffset}
      tabIndex={0}
      autoFocus
      style={mergeStyles({ minWidth: 200, padding: 12 }, style)}
      onMouseDownOutside={(event: EventPayload) => {
        onMouseDownOutside?.(event);
        dismissOutside.current = true;
        queueMicrotask(() => {
          dismissOutside.current = false;
        });
        setOpen(false);
      }}
      onKeyDown={(event: EventPayload) => {
        onKeyDown?.(event);

        if (event.key === "escape") {
          setOpen(false);
        }
      }}
    >
      {children}
    </FloatingLayer>
  );
}
