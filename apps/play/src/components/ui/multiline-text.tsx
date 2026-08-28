import React from "react";
import type { StyleDesc } from "@gpuix/react";
import { mergeStyles } from "./lib/merge-styles";
import { Text, type TextProps } from "./typography";

export interface MultilineTextProps extends Omit<TextProps, "children"> {
  children: string;
  /** Gap between lines in px. */
  lineGap?: number;
  style?: StyleDesc;
}

/**
 * Preserves newlines without `white-space: pre` (unsupported in GPUI).
 * Splits on `\n` and renders one `<text>` per line.
 */
export function MultilineText({
  children,
  lineGap = 2,
  style,
  ...textProps
}: MultilineTextProps) {
  const lines = children.split("\n");

  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column", gap: lineGap }, style)}>
      {lines.map((line, index) => (
        <Text key={index} {...textProps} truncate style={{ whiteSpace: "nowrap" }}>
          {line || " "}
        </Text>
      ))}
    </div>
  );
}
