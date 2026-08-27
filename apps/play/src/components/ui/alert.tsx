import React from "react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

type AlertVariant = "default" | "destructive" | "success" | "warning";

const alertVariants: Record<AlertVariant, { border: string; background: string; title: string; description: string }> = {
  default: {
    border: colors.border,
    background: colors.card,
    title: colors.foreground,
    description: colors.mutedForeground,
  },
  destructive: {
    border: colors.destructive,
    background: "rgba(239,68,68,0.12)",
    title: colors.destructiveForeground,
    description: colors.mutedForeground,
  },
  success: {
    border: colors.success,
    background: "rgba(110,231,183,0.12)",
    title: colors.successForeground,
    description: colors.mutedForeground,
  },
  warning: {
    border: "#fbbf24",
    background: "rgba(251,191,36,0.12)",
    title: "#fbbf24",
    description: colors.mutedForeground,
  },
};

export interface AlertProps extends UiBaseProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
}

export function Alert({ variant = "default", title, children, style }: AlertProps) {
  const tokens = alertVariants[variant];

  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "column",
          gap: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: tokens.background,
        },
        style,
      )}
    >
      {title ? (
        <text style={{ fontSize: 14, fontWeight: 600, color: tokens.title, lineHeight: 18 }}>
          {title}
        </text>
      ) : null}
      {children ? (
        <text style={{ fontSize: 13, color: tokens.description, lineHeight: 18 }}>
          {children}
        </text>
      ) : null}
    </div>
  );
}
