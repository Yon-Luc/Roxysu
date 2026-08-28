import React, { forwardRef, useEffect, useState } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { variants } from "./lib/variants";
import type { UiBaseProps } from "./lib/types";

export type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export const buttonVariants = variants({
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderRadius: radius.md,
    fontWeight: 600,
    cursor: "pointer",
    userSelect: "none",
    gap: spacing.sm,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
  variants: {
    variant: {
      default: {
        backgroundColor: colors.primary,
        color: colors.primaryForeground,
        hover: { backgroundColor: "#a5e3fb" },
      },
      destructive: {
        backgroundColor: colors.destructive,
        color: colors.destructiveForeground,
        hover: { backgroundColor: "#f87171" },
      },
      outline: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.foreground,
        hover: { backgroundColor: colors.secondary },
      },
      secondary: {
        backgroundColor: colors.secondary,
        color: colors.secondaryForeground,
        hover: { backgroundColor: "#262d3c" },
      },
      ghost: {
        backgroundColor: "transparent",
        color: colors.foreground,
        hover: { backgroundColor: colors.secondary },
      },
      link: {
        backgroundColor: "transparent",
        color: colors.primary,
        hover: { opacity: 0.8 },
      },
    },
    size: {
      sm: { height: 32, paddingLeft: spacing.sm, paddingRight: spacing.sm, fontSize: 12 },
      md: { height: 40, paddingLeft: spacing.md, paddingRight: spacing.md, fontSize: 14 },
      lg: { height: 48, paddingLeft: spacing.lg, paddingRight: spacing.lg, fontSize: 16 },
      icon: { height: 40, width: 40, padding: 0 },
    },
  },
  defaultVariants: { variant: "default", size: "md" },
});

export interface ButtonProps extends UiBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<React.ElementRef<"div">, ButtonProps>(
  function Button(
    { variant, size, disabled, loading, onClick, onFocus, onBlur, children, style, tabIndex, testId },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    const isInactive = disabled || loading;

    const resolvedStyle = mergeStyles(
      buttonVariants({ variant, size }),
      focused && !isInactive ? { boxShadow: shadows.focus } : undefined,
      isInactive
        ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" }
        : undefined,
      style,
    );

    return (
      <div
        ref={ref as React.Ref<any>}
        tabIndex={isInactive ? -1 : tabIndex ?? 0}
        style={resolvedStyle}
        onClick={(event: EventPayload) => {
          if (isInactive) {
            return;
          }

          onClick?.(event);
        }}
        onFocus={(event: EventPayload) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event: EventPayload) => {
          setFocused(false);
          onBlur?.(event);
        }}
        testId={testId}
      >
        {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : null}
        {children}
      </div>
    );
  },
);

// ─── Spinner ────────────────────────────────────────────────────────────────

export interface SpinnerProps {
  size?: number;
  color?: string;
  style?: StyleDesc;
}

const DOT_COUNT = 3;

export function Spinner({ size = 16, color = colors.foreground, style }: SpinnerProps) {
  const [phase, setPhase] = useState(0);
  const dotSize = Math.max(4, Math.round(size / 4));
  const gap = Math.max(2, Math.round(dotSize / 2));

  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % DOT_COUNT), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap,
          width: size,
          height: size,
        },
        style,
      )}
    >
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <div
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize,
            backgroundColor: color,
            opacity: i === phase ? 1 : 0.25,
          }}
          motion={
            i === phase
              ? { initial: { opacity: 0.25 }, animate: { opacity: 1 }, transition: { duration: 0.25 } }
              : { initial: { opacity: 1 }, animate: { opacity: 0.25 }, transition: { duration: 0.25 } }
          }
        />
      ))}
    </div>
  );
}
