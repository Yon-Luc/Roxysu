import React, { forwardRef, useState } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";

export interface InputProps extends UiBaseProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onValueChange?: (value: string) => void;
}

export const inputBase: StyleDesc = {
  display: "flex",
  width: "100%",
  height: 40,
  paddingLeft: spacing.sm,
  paddingRight: spacing.sm,
  borderRadius: radius.md,
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.input,
  color: colors.foreground,
  fontSize: 14,
  fontFamily: "inherit",
  cursor: "text",
  userSelect: "text",
};

export const Input = forwardRef<React.ElementRef<"input">, InputProps>(
  function Input(
    {
      value,
      defaultValue = "",
      placeholder,
      disabled,
      readOnly,
      onValueChange,
      style,
      onChange,
      onFocus,
      onBlur,
      tabIndex,
      testId,
    },
    ref,
  ) {
    const [current, setCurrent] = useControllableState<string>({
      value,
      defaultValue,
      onChange: onValueChange,
    });

    const [focused, setFocused] = useState(false);

    const resolvedStyle = mergeStyles(
      inputBase,
      focused ? { borderColor: colors.ring, boxShadow: shadows.focus } : undefined,
      disabled || readOnly
        ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" }
        : undefined,
      style,
    );

    return (
      <input
        ref={ref as React.Ref<any>}
        value={current}
        placeholder={placeholder}
        readOnly={readOnly}
        tabIndex={disabled ? -1 : tabIndex ?? 0}
        style={resolvedStyle}
        testId={testId}
        onFocus={(event: EventPayload) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event: EventPayload) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event: EventPayload) => {
          if (disabled || readOnly) {
            return;
          }

          setCurrent(event.value ?? "");
          onChange?.(event);
        }}
      />
    );
  },
);
