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
 * - `overflow: "scroll"` is required (`"auto"` does not scroll).
 * - Flex children need `minHeight: 0` / `minWidth: 0` to shrink.
 * - **Do not nest** another vertical scroller inside — see GPUIX_CONSTRAINTS.md.
 * - For long content inside an existing scroll parent, use {@link Expandable}.
 */
export const ScrollArea = forwardRef<React.ElementRef<"div">, ScrollAreaProps>(
  function ScrollArea({ orientation = "vertical", style, children, ...rest }, ref) {
    const overflowX =
      orientation === "vertical" ? "hidden" : "scroll";
    const overflowY =
      orientation === "horizontal" ? "hidden" : "scroll";

    return (
      <div
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "block",
            minHeight: 0,
            minWidth: 0,
            flexGrow: 1,
            flexBasis: 0,
            overflow: orientation === "both" ? "scroll" : "hidden",
            overflowX,
            overflowY,
            pointerEvents: "auto",
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
