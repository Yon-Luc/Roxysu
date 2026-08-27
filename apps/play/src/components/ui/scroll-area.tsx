import React, { forwardRef } from "react";
import { colors, radius } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface ScrollAreaProps extends UiBaseProps {
  orientation?: "vertical" | "horizontal" | "both";
  children?: React.ReactNode;
}

/**
 * GPUIX-native scroll container.
 *
 * `overflow: "scroll"` is required (the renderer treats `"auto"` as no
 * scroll), and a flex child must also set `minHeight: 0` so it can shrink.
 */
export const ScrollArea = forwardRef<React.ElementRef<"div">, ScrollAreaProps>(
  function ScrollArea({ orientation = "vertical", style, children, ...rest }, ref) {
    const overflow =
      orientation === "vertical" ? "scroll" : orientation === "horizontal" ? "scroll" : "scroll";

    return (
      <div
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: orientation === "horizontal" ? "row" : "column",
            minHeight: 0,
            minWidth: 0,
            flexGrow: 1,
            flexBasis: 0,
            overflow,
            overflowX: orientation === "horizontal" ? "scroll" : "hidden",
            overflowY: orientation === "vertical" ? "scroll" : "hidden",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
          style,
        )}
      >
        {children}
      </div>
    );
  },
);
