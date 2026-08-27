import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

type SpacingToken = keyof typeof spacing;

interface StackProps extends UiBaseProps {
  direction?: "row" | "column";
  gap?: SpacingToken | number;
  align?: StyleDesc["alignItems"];
  justify?: StyleDesc["justifyContent"];
  wrap?: boolean;
  padded?: boolean;
  children?: React.ReactNode;
}

function resolveGap(gap: SpacingToken | number | undefined): number | undefined {
  if (gap == null) {
    return undefined;
  }

  return typeof gap === "number" ? gap : spacing[gap];
}

function StackImpl(
  {
    direction = "column",
    gap,
    align,
    justify,
    wrap,
    padded,
    style,
    children,
    onClick,
    tabIndex,
    testId,
  }: StackProps,
  ref: React.Ref<React.ElementRef<"div">>,
) {
  const base: StyleDesc = {
    display: "flex",
    flexDirection: direction,
    gap: resolveGap(gap),
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : undefined,
    padding: padded ? spacing.md : undefined,
  };

  return (
    <div
      ref={ref as React.Ref<any>}
      style={mergeStyles(base, style)}
      onClick={onClick}
      tabIndex={tabIndex}
      testId={testId}
    >
      {children}
    </div>
  );
}

export const Stack = forwardRef(StackImpl);

export const VStack = forwardRef<React.ElementRef<"div">, Omit<StackProps, "direction">>(
  function VStack(props, ref) {
    return <Stack {...props} direction="column" ref={ref} />;
  },
);

export const HStack = forwardRef<React.ElementRef<"div">, Omit<StackProps, "direction">>(
  function HStack(props, ref) {
    return <Stack {...props} direction="row" ref={ref} />;
  },
);

// ─── Center ─────────────────────────────────────────────────────────────────

export interface CenterProps extends UiBaseProps {
  children?: React.ReactNode;
}

export const Center = forwardRef<React.ElementRef<"div">, CenterProps>(
  function Center({ style, children, onClick, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { display: "flex", alignItems: "center", justifyContent: "center" },
          style,
        )}
        onClick={onClick}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);

// ─── Spacer ─────────────────────────────────────────────────────────────────

export function Spacer({ style }: { style?: StyleDesc }) {
  return <div style={mergeStyles({ flexGrow: 1, flexBasis: 0 }, style)} />;
}

// ─── Container ──────────────────────────────────────────────────────────────

export interface ContainerProps extends UiBaseProps {
  maxWidth?: number;
  centered?: boolean;
  children?: React.ReactNode;
}

export const Container = forwardRef<React.ElementRef<"div">, ContainerProps>(
  function Container({ maxWidth = 1024, centered = true, style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            width: "100%",
            maxWidth,
            alignSelf: centered ? "center" : undefined,
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

// ─── Grid ───────────────────────────────────────────────────────────────────

export interface GridProps extends UiBaseProps {
  columns?: number;
  gap?: SpacingToken | number;
  children?: React.ReactNode;
}

export const Grid = forwardRef<React.ElementRef<"div">, GridProps>(
  function Grid({ columns = 2, gap, style, children, testId }, ref) {
    const resolvedGap = resolveGap(gap) ?? spacing.md;

    const items = React.Children.toArray(children);
    const rows: React.ReactNode[][] = [];

    for (let i = 0; i < items.length; i += columns) {
      rows.push(items.slice(i, i + columns));
    }

    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            gap: resolvedGap,
          },
          style,
        )}
        testId={testId}
      >
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={{ display: "flex", flexDirection: "row", gap: resolvedGap }}
          >
            {row.map((child, colIndex) => (
              <div
                key={colIndex}
                style={{ flexGrow: 1, flexBasis: 0, flexShrink: 1, minWidth: 0 }}
              >
                {child}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  },
);
