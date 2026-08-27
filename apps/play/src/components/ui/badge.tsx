import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { variants } from "./lib/variants";
import type { UiBaseProps } from "./lib/types";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "outline";

export const badgeVariants = variants({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    fontWeight: 600,
    fontSize: 11,
    lineHeight: 15,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  variants: {
    variant: {
      default: { backgroundColor: colors.primary, color: colors.primaryForeground },
      secondary: { backgroundColor: colors.secondary, color: colors.secondaryForeground },
      destructive: {
        backgroundColor: colors.destructive,
        color: colors.destructiveForeground,
      },
      success: { backgroundColor: colors.success, color: colors.successForeground },
      outline: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.foreground,
      },
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends UiBaseProps {
  variant?: BadgeVariant;
  children?: React.ReactNode;
}

export const Badge = forwardRef<React.ElementRef<"div">, BadgeProps>(
  function Badge({ variant, children, style, ...rest }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(badgeVariants({ variant }), style)}
        onClick={rest.onClick}
        onMouseEnter={rest.onMouseEnter}
        onMouseLeave={rest.onMouseLeave}
        testId={rest.testId}
      >
        {children}
      </div>
    );
  },
);
