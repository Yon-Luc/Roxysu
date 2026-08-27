import React, { forwardRef, useState } from "react";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { useControllableState } from "./lib/utils";
import type { UiBaseProps } from "./lib/types";
import { inputBase } from "./input";

export interface TextareaProps extends UiBaseProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  minRows?: number;
  maxRows?: number;
  onValueChange?: (value: string) => void;
}

export const Textarea = forwardRef<React.ElementRef<"textarea">, TextareaProps>(
  function Textarea(
    {
      value,
      defaultValue = "",
      placeholder,
      disabled,
      readOnly,
      minRows = 3,
      maxRows = 10,
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
      {
        height: "auto",
        minHeight: minRows * 22 + spacing.md,
        maxHeight: maxRows * 22 + spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        lineHeight: 1.5,
        whiteSpace: "normal",
        overflow: "auto",
      },
      focused ? { borderColor: colors.ring, boxShadow: shadows.focus } : undefined,
      disabled || readOnly
        ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" }
        : undefined,
      style,
    );

    return (
      <textarea
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
