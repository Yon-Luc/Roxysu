import React, { createContext, useContext, useMemo } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(name: string): TabsContextValue {
  const context = useContext(TabsContext);

  if (!context) {
    throw new Error(`${name} must be used inside <Tabs>`);
  }

  return context;
}

export interface TabsProps extends UiBaseProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}

export function Tabs({ value, defaultValue, onValueChange, style, children, testId }: TabsProps) {
  const [current, setCurrent] = useControllableState<string>({
    value,
    defaultValue: defaultValue ?? "",
    onChange: (next) => onValueChange?.(next),
  });

  const context = useMemo<TabsContextValue>(
    () => ({ value: current, setValue: setCurrent }),
    [current, setCurrent],
  );

  return (
    <TabsContext.Provider value={context}>
      <div
        style={mergeStyles({ display: "flex", flexDirection: "column", gap: spacing.md }, style)}
        testId={testId}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends UiBaseProps {
  children?: React.ReactNode;
}

export const TabsList = React.forwardRef<React.ElementRef<"div">, TabsListProps>(
  function TabsList({ style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "row",
            gap: spacing.xs,
            padding: 4,
            backgroundColor: colors.muted,
            borderRadius: radius.md,
            alignSelf: "flex-start",
          },
          style,
        )}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);

export interface TabsTriggerProps extends UiBaseProps {
  value: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const TabsTrigger = React.forwardRef<React.ElementRef<"div">, TabsTriggerProps>(
  function TabsTrigger({ value, disabled, style, children, onClick, onFocus, onBlur, tabIndex, testId }, ref) {
    const { value: active, setValue } = useTabsContext("TabsTrigger");
    const selected = active === value;

    return (
      <div
        ref={ref as React.Ref<any>}
        tabIndex={disabled ? -1 : tabIndex ?? 0}
        style={mergeStyles(
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
            paddingLeft: spacing.md,
            paddingRight: spacing.md,
            borderRadius: radius.sm,
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            userSelect: "none",
            backgroundColor: selected ? colors.background : "transparent",
            color: selected ? colors.foreground : colors.mutedForeground,
            opacity: disabled ? 0.5 : 1,
          },
          style,
        )}
        onClick={(event: EventPayload) => {
          if (disabled) {
            return;
          }

          setValue(value);
          onClick?.(event);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);

export interface TabsContentProps extends UiBaseProps {
  value: string;
  children?: React.ReactNode;
}

export const TabsContent = React.forwardRef<React.ElementRef<"div">, TabsContentProps>(
  function TabsContent({ value, style, children, testId }, ref) {
    const { value: active } = useTabsContext("TabsContent");

    if (active !== value) {
      return null;
    }

    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles({ display: "flex", flexDirection: "column", gap: spacing.sm }, style)}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);
