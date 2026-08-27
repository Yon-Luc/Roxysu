import React, { forwardRef } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows } from "../theme";
import { mergeStyles } from "./merge-styles";

export type FloatingSide = "top" | "right" | "bottom" | "left";
export type FloatingAlign = "start" | "center" | "end";

export interface FloatingContentProps {
  children?: React.ReactNode;
  side?: FloatingSide;
  sideOffset?: number;
  align?: FloatingAlign;
  alignOffset?: number;
  collisionPadding?: number;
  occlude?: boolean;
  /** Explicit translate from the snapped anchor (e.g. cursor position). Overrides the side-derived offset. */
  offset?: { x: number; y: number };
  tabIndex?: number;
  autoFocus?: boolean;
  style?: StyleDesc;
  onMouseDownOutside?: (event: EventPayload) => void;
  onKeyDown?: (event: EventPayload) => void;
}

/**
 * GPUIX-native floating surface.
 *
 * Renders an `anchored` element (a native overlay layer) anchored to its
 * previous sibling — the trigger. `anchored` is positioned by the native
 * renderer, so there are no DOM portals, `getBoundingClientRect`, or CSS
 * dependencies.
 */
/**
 * Mirrors `@gpuix/react`'s internal FloatingLayer exactly (the one `Select` and
 * `Combobox` use successfully). The `anchored` element is positioned by the
 * native renderer; `props` are spread onto the inner surface so `style`,
 * `onMouseDownOutside`, `onKeyDown` and `ref` all reach it.
 */
export const FloatingLayer = forwardRef<
  React.ElementRef<"div">,
  FloatingContentProps
>(function FloatingLayer(
  { side = "bottom", align = "start", sideOffset = 0, alignOffset = 0, collisionPadding = 8, occlude = true, offset, children, style, onMouseDownOutside, onKeyDown, ...rest },
  ref,
) {
  const resolvedOffset =
    offset ??
    (side === "top" || side === "bottom" ? { x: alignOffset, y: 0 } : { x: 0, y: alignOffset });

  const surfaceStyle: StyleDesc = {
    backgroundColor: colors.popover,
    color: colors.popoverForeground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    boxShadow: shadows.md,
  };

  return (
    <anchored
      side={side}
      align={align}
      gap={sideOffset}
      fit="snap"
      snapMargin={collisionPadding}
      deferred
      priority={1}
      occlude={occlude}
      offset={resolvedOffset}
    >
      <div
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(surfaceStyle, style)}
        onMouseDownOutside={onMouseDownOutside}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </anchored>
  );
});

/** Wrapper style that makes a floating root establish a positioning context. */
export function floatingRootStyle(style?: StyleDesc): StyleDesc {
  return {
    display: "flex",
    position: "relative",
    alignItems: "start",
    ...style,
  };
}
