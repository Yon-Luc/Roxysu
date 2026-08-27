import React, { forwardRef } from "react";
import {
  Select as GpuixSelect,
  SelectContent as GpuixSelectContent,
  SelectGroup as GpuixSelectGroup,
  SelectItem as GpuixSelectItem,
  SelectLabel as GpuixSelectLabel,
  SelectSeparator as GpuixSelectSeparator,
  SelectTrigger as GpuixSelectTrigger,
  SelectValue as GpuixSelectValue,
} from "@gpuix/react";
import type {
  SelectContentProps,
  SelectItemState,
  SelectProps,
  SelectTriggerProps,
  SelectTriggerState,
} from "@gpuix/react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";

export const Select = GpuixSelect;
export const SelectGroup = GpuixSelectGroup;
export const SelectLabel = GpuixSelectLabel;
export const SelectSeparator = GpuixSelectSeparator;
export const SelectValue = GpuixSelectValue;

export const SelectTrigger = forwardRef<React.ElementRef<"div">, SelectTriggerProps>(
  function SelectTrigger({ style, ...rest }, ref) {
    return (
      <GpuixSelectTrigger
        {...rest}
        ref={ref as React.Ref<any>}
        style={(state: SelectTriggerState) =>
          mergeStyles(
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
            typeof style === "function" ? style(state) : style,
          )
        }
      />
    );
  },
);

export const SelectContent = forwardRef<React.ElementRef<"div">, SelectContentProps>(
  function SelectContent({ style, ...rest }, ref) {
    return (
      <GpuixSelectContent
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            minWidth: 180,
            padding: 6,
            backgroundColor: colors.popover,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
          style,
        )}
      />
    );
  },
);

// NOTE: `SelectItem` MUST remain the native reference. The headless `Select`
// collects its options by identity-checking `child.type === SelectItem`, so a
// styled wrapper component would not be recognized and selection would be a
// no-op. Apply styling via the `style` prop using `selectItemStyle` below.
export const SelectItem = GpuixSelectItem;

export const selectItemStyle = (state: SelectItemState): StyleDesc => ({
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
});

export type { SelectProps };
