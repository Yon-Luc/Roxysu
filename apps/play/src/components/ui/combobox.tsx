import React, { forwardRef } from "react";
import {
  Combobox as GpuixCombobox,
  ComboboxContent as GpuixComboboxContent,
  ComboboxEmpty as GpuixComboboxEmpty,
  ComboboxGroup as GpuixComboboxGroup,
  ComboboxInput as GpuixComboboxInput,
  ComboboxItem as GpuixComboboxItem,
  ComboboxLabel as GpuixComboboxLabel,
  ComboboxList as GpuixComboboxList,
  ComboboxSeparator as GpuixComboboxSeparator,
  ComboboxTrigger as GpuixComboboxTrigger,
  ComboboxValue as GpuixComboboxValue,
} from "@gpuix/react";
import type {
  ComboboxInputProps,
  ComboboxItemProps,
  ComboboxItemState,
  ComboboxProps,
  ComboboxTriggerProps,
} from "@gpuix/react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius, shadows, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";

export const Combobox = GpuixCombobox;
export const ComboboxContent = forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<typeof GpuixComboboxContent>
>(function ComboboxContent({ style, ...rest }, ref) {
  return (
    <GpuixComboboxContent
      {...rest}
      ref={ref as React.Ref<any>}
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
          minWidth: 220,
          padding: spacing.sm,
          backgroundColor: colors.popover,
          color: colors.popoverForeground,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: shadows.md,
        },
        style,
      )}
    />
  );
});
export const ComboboxEmpty = GpuixComboboxEmpty;
export const ComboboxGroup = GpuixComboboxGroup;
export const ComboboxLabel = GpuixComboboxLabel;
export const ComboboxList = forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<typeof GpuixComboboxList>
>(function ComboboxList({ style, ...rest }, ref) {
  return (
    <GpuixComboboxList
      {...rest}
      ref={ref as React.Ref<any>}
      style={mergeStyles(
        {
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 240,
          overflow: "scroll",
        },
        style,
      )}
    />
  );
});
export const ComboboxSeparator = GpuixComboboxSeparator;
export const ComboboxValue = GpuixComboboxValue;

export const ComboboxTrigger = forwardRef<React.ElementRef<"div">, ComboboxTriggerProps>(
  function ComboboxTrigger({ style, ...rest }, ref) {
    return (
      <GpuixComboboxTrigger
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
            height: 40,
            width: "100%",
            paddingLeft: spacing.sm,
            paddingRight: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.input,
            color: colors.foreground,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: "pointer",
            userSelect: "none",
          },
          style,
        )}
      />
    );
  },
);

export const ComboboxInput = forwardRef<React.ElementRef<"input">, ComboboxInputProps>(
  function ComboboxInput({ style, ...rest }, ref) {
    return (
      <GpuixComboboxInput
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            width: "100%",
            height: 36,
            paddingLeft: spacing.sm,
            paddingRight: spacing.sm,
            borderRadius: radius.sm,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.input,
            color: colors.foreground,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: "text",
          },
          style,
        )}
      />
    );
  },
);

export const ComboboxItem = forwardRef<React.ElementRef<"div">, ComboboxItemProps>(
  function ComboboxItem({ style, ...rest }, ref) {
    return (
      <GpuixComboboxItem
        {...rest}
        ref={ref as React.Ref<any>}
        style={(state: ComboboxItemState) =>
          mergeStyles(
            {
              display: "flex",
              alignItems: "center",
              height: 34,
              paddingLeft: spacing.sm,
              paddingRight: spacing.sm,
              borderRadius: radius.sm,
              color: colors.foreground,
              fontSize: 13,
              cursor: "pointer",
              userSelect: "none",
              backgroundColor: state.highlighted ? colors.secondary : "transparent",
              opacity: state.disabled ? 0.5 : 1,
            },
            typeof style === "function" ? style(state) : style,
          )
        }
      />
    );
  },
);

export type { ComboboxProps };
