import React, { forwardRef, useState } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";

export interface SwitchProps extends UiBaseProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const TRACK_W = 40;
const TRACK_H = 22;
const KNOB = 16;

export const Switch = forwardRef<React.ElementRef<"div">, SwitchProps>(
  function Switch(
    { checked, defaultChecked = false, disabled, onCheckedChange, style, onClick, onFocus, onBlur, onKeyDown, tabIndex, testId },
    ref,
  ) {
    const [value, setValue] = useControllableState<boolean>({
      value: checked,
      defaultValue: defaultChecked,
      onChange: onCheckedChange,
    });

    const [focused, setFocused] = useState(false);

    const resolvedStyle = mergeStyles(
      {
        width: TRACK_W,
        height: TRACK_H,
        borderRadius: TRACK_H,
        padding: (TRACK_H - KNOB) / 2,
        backgroundColor: value ? colors.primary : colors.muted,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: value ? "flex-end" : "flex-start",
        userSelect: "none",
        flexShrink: 0,
      },
      focused ? { boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: colors.ring } } : undefined,
      disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined,
      style,
    );

    const toggle = () => {
      if (disabled) {
        return;
      }

      setValue(!value);
    };

    return (
      <div
        ref={ref as React.Ref<any>}
        tabIndex={disabled ? -1 : tabIndex ?? 0}
        style={resolvedStyle}
        onClick={(event: EventPayload) => {
          toggle();
          onClick?.(event);
        }}
        onKeyDown={(event: EventPayload) => {
          if (event.key === " " || event.key === "Enter") {
            toggle();
          }

          onKeyDown?.(event);
        }}
        onFocus={(event: EventPayload) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event: EventPayload) => {
          setFocused(false);
          onBlur?.(event);
        }}
        testId={testId}
      >
        <div
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB,
            backgroundColor: colors.background,
          }}
        />
      </div>
    );
  },
);
