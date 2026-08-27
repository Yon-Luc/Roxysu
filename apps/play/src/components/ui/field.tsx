import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { Label } from "./label";
import type { UiBaseProps } from "./lib/types";

export interface FieldProps extends UiBaseProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}

/**
 * Labelled form control wrapper. Composes a {@link Label}, optional helper
 * text, the control, and an optional error message. The control is passed as
 * `children` so any input-like component can live inside.
 */
export const Field = forwardRef<React.ElementRef<"div">, FieldProps>(
  function Field({ label, description, error, disabled, style, children, testId }, ref) {
    return (
      <div
        ref={ref as React.Ref<any>}
        style={mergeStyles({ display: "flex", flexDirection: "column", gap: spacing.xs }, style)}
        testId={testId}
      >
        {label != null ? (
          <Label disabled={disabled}>{label}</Label>
        ) : null}

        {description != null ? (
          <text style={{ fontSize: 11, color: "#8b95a8", lineHeight: 1.4 }}>{description}</text>
        ) : null}

        {children}

        {error != null ? (
          <text style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.4 }}>{error}</text>
        ) : null}
      </div>
    );
  },
);
