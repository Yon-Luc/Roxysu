import React, { useState } from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { UiBaseProps } from "./lib/types";
import { Text } from "./typography";

export interface ExpandableProps extends UiBaseProps {
  /** Shown while collapsed — keep this short; no inner scroll viewport. */
  preview: React.ReactNode;
  /** Full content; only mounted when expanded. */
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showMoreLabel?: string;
  showLessLabel?: string;
}

/**
 * Avoid nested vertical scroll containers (GPUIX does not support them).
 * Renders a preview and toggles full content in place.
 */
export function Expandable({
  preview,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  showMoreLabel = "Show more",
  showLessLabel = "Show less",
  style,
  testId,
}: ExpandableProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;

  const setOpen = (next: boolean) => {
    if (open === undefined) {
      setInternalOpen(next);
    }

    onOpenChange?.(next);
  };

  return (
    <div
      style={mergeStyles({ display: "flex", flexDirection: "column", gap: spacing.sm }, style)}
      testId={testId}
    >
      {isOpen ? children : preview}
      <div
        tabIndex={0}
        testId={testId ? `${testId}-toggle` : undefined}
        style={{
          alignSelf: "flex-start",
          cursor: "pointer",
          userSelect: "none",
          color: colors.primary,
          hover: { opacity: 0.85 },
        }}
        onClick={() => setOpen(!isOpen)}
      >
        <Text size="sm" color={colors.primary}>
          {isOpen ? showLessLabel : showMoreLabel}
        </Text>
      </div>
    </div>
  );
}
