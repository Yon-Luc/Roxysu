import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors, typography } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface LabelProps extends UiBaseProps {
  disabled?: boolean;
  children?: React.ReactNode;
}

export const Label = forwardRef<React.ElementRef<"text">, LabelProps>(
  function Label({ disabled, style, children, onClick, testId }, ref) {
    return (
      <text
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            fontSize: typography.fontSizes.sm,
            fontWeight: typography.fontWeights.semibold,
            color: disabled ? colors.mutedForeground : colors.foreground,
            userSelect: "none",
          },
          style,
        )}
        onClick={onClick}
        testId={testId}
      >
        {children}
      </text>
    );
  },
);
