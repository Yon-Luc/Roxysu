import React, { forwardRef } from "react";
import {
  Tooltip as GpuixTooltip,
  TooltipContent as GpuixTooltipContent,
  TooltipProvider as GpuixTooltipProvider,
  TooltipTrigger as GpuixTooltipTrigger,
} from "@gpuix/react";
import type { TooltipContentProps as GpuixTooltipContentProps } from "@gpuix/react";
import { colors, radius, shadows } from "./theme";
import { mergeStyles } from "./lib/merge-styles";

export const TooltipProvider = GpuixTooltipProvider;
export const Tooltip = GpuixTooltip;
export const TooltipTrigger = GpuixTooltipTrigger;

/** Tooltip content styled with the library panel token. */
export const TooltipContent = forwardRef<React.ElementRef<"div">, GpuixTooltipContentProps>(
  function TooltipContent({ style, ...rest }, ref) {
    return (
      <GpuixTooltipContent
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            backgroundColor: colors.popover,
            color: colors.popoverForeground,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.border,
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 10,
            paddingRight: 10,
            fontSize: 12,
            fontWeight: 500,
            boxShadow: shadows.md,
          },
          style,
        )}
      />
    );
  },
);
