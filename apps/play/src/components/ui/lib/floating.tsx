import type { EventPayload, StyleDesc } from "@gpuix/react";
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
export function FloatingLayer({
  side = "bottom",
  align = "start",
  sideOffset = 0,
  alignOffset = 0,
  collisionPadding = 8,
  children,
  style,
  onMouseDownOutside,
  onKeyDown,
}: FloatingContentProps) {
  const offset =
    side === "top" || side === "bottom"
      ? { x: alignOffset, y: 0 }
      : { x: 0, y: alignOffset };

  const surfaceStyle = mergeStyles(
    {
      backgroundColor: "#151922",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#252b36",
      padding: 8,
      boxShadow: {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 12,
        spreadRadius: 0,
        color: "rgba(0,0,0,0.45)",
      },
    } satisfies StyleDesc,
    style,
  );

  return (
    <anchored
      side={side}
      align={align}
      gap={sideOffset}
      offset={offset}
      fit="snap"
      snapMargin={collisionPadding}
      deferred
      priority={1}
      occlude
    >
      <div
        style={surfaceStyle}
        onMouseDownOutside={onMouseDownOutside}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </anchored>
  );
}

/** Wrapper style that makes a floating root establish a positioning context. */
export function floatingRootStyle(style?: StyleDesc): StyleDesc {
  return {
    display: "flex",
    position: "relative",
    alignItems: "start",
    ...style,
  };
}
