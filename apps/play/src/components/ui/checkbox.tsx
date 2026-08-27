import React, { forwardRef, useState } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";

export interface CheckboxProps extends UiBaseProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const BOX = 18;

export const Checkbox = forwardRef<React.ElementRef<"div">, CheckboxProps>(
  function Checkbox(
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
        width: BOX,
        height: BOX,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: value ? colors.primary : colors.input,
        backgroundColor: value ? colors.primary : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
        {value ? (
          <text style={{ fontSize: 13, fontWeight: 700, color: colors.primaryForeground }}>✓</text>
        ) : null}
      </div>
    );
  },
);
