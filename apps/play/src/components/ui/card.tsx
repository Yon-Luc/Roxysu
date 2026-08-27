import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface CardProps extends UiBaseProps {
  children?: React.ReactNode;
}

export const Card = forwardRef<React.ElementRef<"div">, CardProps>(
  function Card({ style, children, onClick, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            backgroundColor: colors.card,
            color: colors.cardForeground,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            boxShadow: shadows.md,
            overflow: "hidden",
          },
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

export const CardHeader = forwardRef<React.ElementRef<"div">, CardProps>(
  function CardHeader({ style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { display: "flex", flexDirection: "column", gap: spacing.xs, padding: spacing.lg },
          style,
        )}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);

export const CardTitle = forwardRef<React.ElementRef<"text">, Omit<CardProps, "children"> & { children?: React.ReactNode }>(
  function CardTitle({ style, children, testId }, ref) {
    return (
      <text
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { fontSize: 18, fontWeight: 700, color: colors.foreground, lineHeight: 1.2 },
          style,
        )}
        testId={testId}
      >
        {children}
      </text>
    );
  },
);

export const CardDescription = forwardRef<React.ElementRef<"text">, Omit<CardProps, "children"> & { children?: React.ReactNode }>(
  function CardDescription({ style, children, testId }, ref) {
    return (
      <text
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { fontSize: 13, color: colors.mutedForeground, lineHeight: 1.4 },
          style,
        )}
        testId={testId}
      >
        {children}
      </text>
    );
  },
);

export const CardContent = forwardRef<React.ElementRef<"div">, CardProps>(
  function CardContent({ style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { display: "flex", flexDirection: "column", gap: spacing.sm, padding: spacing.lg, paddingTop: 0 },
          style,
        )}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);

export const CardFooter = forwardRef<React.ElementRef<"div">, CardProps>(
  function CardFooter({ style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          { display: "flex", alignItems: "center", gap: spacing.sm, padding: spacing.lg, paddingTop: 0 },
          style,
        )}
        testId={testId}
      >
        {children}
      </div>
    );
  },
);
