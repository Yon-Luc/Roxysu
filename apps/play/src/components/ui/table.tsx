import React from "react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { StyleDesc } from "@gpuix/react";

export interface TableProps {
  children?: React.ReactNode;
  style?: StyleDesc;
}

/** Div-based table (GPUIX has no native `table`/`tr`/`td` host elements). */
export function Table({ children, style }: TableProps) {
  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
          backgroundColor: colors.card,
        },
        style,
      )}
    >
      {children}
    </div>
  );
}

export function TableHeader({ children, style }: TableProps) {
  return (
    <div
      style={mergeStyles(
        { display: "flex", flexDirection: "column", backgroundColor: colors.secondary },
        style,
      )}
    >
      {children}
    </div>
  );
}

export function TableBody({ children, style }: TableProps) {
  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column" }, style)}>
      {children}
    </div>
  );
}

export function TableRow({ children, style }: TableProps) {
  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "row",
          borderTopWidth: 1,
          borderColor: colors.border,
        },
        style,
      )}
    >
      {children}
    </div>
  );
}

export function TableHead({ children, style }: TableProps) {
  return (
    <text
      style={mergeStyles(
        {
          display: "flex",
          flexGrow: 1,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          paddingLeft: spacing.md,
          paddingRight: spacing.md,
          fontSize: 12,
          fontWeight: 600,
          color: colors.mutedForeground,
          textAlign: "left",
        },
        style,
      )}
    >
      {children}
    </text>
  );
}

export function TableCell({ children, style }: TableProps) {
  return (
    <text
      style={mergeStyles(
        {
          display: "flex",
          flexGrow: 1,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          paddingLeft: spacing.md,
          paddingRight: spacing.md,
          fontSize: 13,
          color: colors.foreground,
          lineHeight: 18,
        },
        style,
      )}
    >
      {children}
    </text>
  );
}
