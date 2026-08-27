import React, { forwardRef } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, typography } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiEventProps } from "./lib/types";

export type TextSize = keyof typeof typography.fontSizes;
export type TextWeight = keyof typeof typography.fontWeights;

export interface TextProps extends UiEventProps {
  size?: TextSize;
  weight?: TextWeight;
  color?: string;
  muted?: boolean;
  truncate?: boolean;
  align?: StyleDesc["textAlign"];
  style?: StyleDesc;
  children?: React.ReactNode;
}

export function Text({
  size = "md",
  weight = "normal",
  color,
  muted,
  truncate,
  align,
  style,
  onClick,
  onMouseDown,
  onMouseUp,
  onMouseEnter,
  onMouseLeave,
  children,
}: TextProps) {
  return (
    <text
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={mergeStyles(
        {
          fontSize: typography.fontSizes[size],
          fontWeight: typography.fontWeights[weight],
          color: color ?? (muted ? colors.mutedForeground : colors.foreground),
          textAlign: align,
          whiteSpace: truncate ? "nowrap" : undefined,
          textOverflow: truncate ? "ellipsis" : undefined,
          lineHeight: typography.fontSizes[size] * typography.lineHeights.normal,
        },
        style,
      )}
    >
      {children}
    </text>
  );
}

export type HeadingLevel = 1 | 2 | 3 | 4;

const HEADING_SIZES: Record<HeadingLevel, TextSize> = {
  1: "3xl",
  2: "2xl",
  3: "xl",
  4: "lg",
};

export interface HeadingProps extends Omit<TextProps, "size"> {
  level?: HeadingLevel;
}

export const Heading = forwardRef<React.ElementRef<"text">, HeadingProps>(
  function Heading({ level = 2, weight = "bold", color, style, children }, ref) {
    return (
      <text
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            fontSize: typography.fontSizes[HEADING_SIZES[level]],
            fontWeight: typography.fontWeights[weight],
            color: color ?? colors.foreground,
            lineHeight: typography.fontSizes[HEADING_SIZES[level]] * typography.lineHeights.tight,
          },
          style,
        )}
      >
        {children}
      </text>
    );
  },
);
