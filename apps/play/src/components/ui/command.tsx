import React, { forwardRef } from "react";
import {
  Combobox as GpuixCombobox,
  ComboboxEmpty as GpuixComboboxEmpty,
  ComboboxGroup as GpuixComboboxGroup,
  ComboboxSeparator as GpuixComboboxSeparator,
} from "@gpuix/react";
import type { ComboboxProps, ComboboxItemProps, ComboboxItemState } from "@gpuix/react";
import type { StyleDesc } from "@gpuix/react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import { ComboboxInput, ComboboxList, ComboboxItem } from "./combobox";
import { Dialog, DialogContent } from "./dialog";

/** Command palette root: always-visible column layout (no trigger/anchored content). */
export const Command = forwardRef<React.ElementRef<"div">, ComboboxProps & { style?: StyleDesc }>(
  function Command({ style, ...rest }, ref) {
    return (
      <GpuixCombobox
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            minHeight: 0,
            gap: 0,
          },
          style,
        )}
      />
    );
  },
);

export const CommandInput = ComboboxInput;
export const CommandItem = forwardRef<React.ElementRef<"div">, ComboboxItemProps & { style?: StyleDesc | ((state: ComboboxItemState) => StyleDesc) }>(
  function CommandItem({ style, ...rest }, ref) {
    return (
      <ComboboxItem
        {...rest}
        ref={ref as React.Ref<any>}
        style={(state) =>
          mergeStyles(
            {
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              height: 36,
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

export const CommandList = forwardRef<React.ElementRef<"div">, React.ComponentPropsWithoutRef<typeof ComboboxList>>(
  function CommandList({ style, ...rest }, ref) {
    return (
      <ComboboxList
        {...rest}
        ref={ref as React.Ref<any>}
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: spacing.xs,
            minHeight: 120,
            maxHeight: 280,
            overflow: "scroll",
          },
          style,
        )}
      />
    );
  },
);

export const CommandEmpty = GpuixComboboxEmpty;
export const CommandGroup = GpuixComboboxGroup;
export const CommandSeparator = GpuixComboboxSeparator;

export interface CommandDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

/** A command palette rendered inside a Dialog surface. */
export function CommandDialog({ open, onOpenChange, children }: CommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{
          padding: 0,
          minWidth: 360,
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export type { ComboboxProps };
