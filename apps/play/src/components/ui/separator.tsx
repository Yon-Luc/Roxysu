import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface SeparatorProps extends UiBaseProps {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export const Separator = forwardRef<React.ElementRef<"div">, SeparatorProps>(
  function Separator({ orientation = "horizontal", style, ...rest }, ref) {
    const base: StyleDesc =
      orientation === "horizontal"
        ? { width: "100%", height: 1, backgroundColor: colors.border }
        : { height: "100%", width: 1, backgroundColor: colors.border };

    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(base, style)}
        testId={rest.testId}
      />
    );
  },
);
