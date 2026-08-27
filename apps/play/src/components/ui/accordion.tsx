import React, { createContext, useContext, useMemo, isValidElement } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState, renderSlot } from "./lib/utils";

type AccordionValue = string | string[] | undefined;

interface AccordionContextValue {
  type: "single" | "multiple";
  value: AccordionValue;
  toggle: (itemValue: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext(name: string): AccordionContextValue {
  const context = useContext(AccordionContext);

  if (!context) {
    throw new Error(`${name} must be used inside <Accordion>`);
  }

  return context;
}

export interface AccordionProps {
  type?: "single" | "multiple";
  children?: React.ReactNode;
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  collapsible?: boolean;
}

export function Accordion({
  type = "single",
  children,
  value,
  defaultValue,
  onValueChange,
  collapsible = true,
}: AccordionProps) {
  const [current, setCurrent] = useControllableState<string | string[]>({
    value,
    defaultValue: (defaultValue ?? (type === "multiple" ? [] : "")) as string | string[],
    onChange: (next) => onValueChange?.(next),
  });

  const context = useMemo<AccordionContextValue>(
    () => ({
      type,
      value: current,
      toggle: (itemValue: string) => {
        if (type === "multiple") {
          const list = Array.isArray(current) ? current : [];
          const next = list.includes(itemValue)
            ? list.filter((v) => v !== itemValue)
            : [...list, itemValue];
          setCurrent(next);
        } else {
          const open = current === itemValue;
          setCurrent(open && collapsible ? "" : itemValue);
        }
      },
    }),
    [type, current, setCurrent, collapsible],
  );

  return <AccordionContext.Provider value={context}>{children}</AccordionContext.Provider>;
}

interface AccordionItemContextValue {
  itemValue: string;
  open: boolean;
}

const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

export interface AccordionItemProps {
  value: string;
  children?: React.ReactNode;
  disabled?: boolean;
}

export function AccordionItem({ value, children, disabled }: AccordionItemProps) {
  const { value: current, toggle } = useAccordionContext("AccordionItem");
  const open = Array.isArray(current) ? current.includes(value) : current === value;

  const itemContext = useMemo<AccordionItemContextValue>(
    () => ({ itemValue: value, open }),
    [value, open],
  );

  return (
    <AccordionItemContext.Provider value={itemContext}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.card,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export interface AccordionTriggerProps {
  asChild?: boolean;
  children?: React.ReactNode;
  onClick?: (event: EventPayload) => void;
}

export function AccordionTrigger({ asChild, children, onClick }: AccordionTriggerProps) {
  const { toggle } = useAccordionContext("AccordionTrigger");
  const item = useContext(AccordionItemContext);

  if (!item) {
    throw new Error("AccordionTrigger must be used inside <AccordionItem>");
  }

  const asChildResolved = asChild ?? (isValidElement(children) ? true : false);

  return renderSlot({
    asChild: asChildResolved,
    children,
    props: {
      onClick: (event: EventPayload) => {
        onClick?.(event);
        toggle(item.itemValue);
      },
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        paddingLeft: spacing.md,
        paddingRight: spacing.md,
        cursor: "pointer",
        userSelect: "none",
      },
    },
  });
}

export interface AccordionContentProps {
  children?: React.ReactNode;
  style?: StyleDesc;
}

export function AccordionContent({ children, style }: AccordionContentProps) {
  const item = useContext(AccordionItemContext);

  if (!item) {
    throw new Error("AccordionContent must be used inside <AccordionItem>");
  }

  if (!item.open) {
    return null;
  }

  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "column",
          paddingLeft: spacing.md,
          paddingRight: spacing.md,
          paddingBottom: spacing.md,
          fontSize: 13,
          color: colors.mutedForeground,
          lineHeight: 18,
        },
        style,
      )}
    >
      {children}
    </div>
  );
}
