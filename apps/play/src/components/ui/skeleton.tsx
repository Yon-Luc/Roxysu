import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";

export interface SkeletonProps extends UiBaseProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
}

export const Skeleton = forwardRef<React.ElementRef<"div">, SkeletonProps>(
  function Skeleton({ width, height, radius: r, style, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            backgroundColor: colors.muted,
            width: width ?? "100%",
            height: height ?? 14,
            borderRadius: r ?? radius.sm,
          },
          style,
        )}
        testId={testId}
      />
    );
  },
);
