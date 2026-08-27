import React from "react";
import { colors, radius } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface ProgressProps extends UiBaseProps {
  value?: number;
  max?: number;
  indicatorColor?: string;
}

export function Progress({ value = 0, max = 100, indicatorColor = colors.primary, style }: ProgressProps) {
  const clamped = Math.max(0, Math.min(max, value));
  const percent = max <= 0 ? 0 : (clamped / max) * 100;

  return (
    <div
      style={mergeStyles(
        {
          display: "flex",
          width: "100%",
          height: 8,
          borderRadius: 999,
          backgroundColor: colors.secondary,
          overflow: "hidden",
        },
        style,
      )}
    >
      <div
        style={{
          display: "flex",
          width: `${percent}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: indicatorColor,
        }}
      />
    </div>
  );
}
