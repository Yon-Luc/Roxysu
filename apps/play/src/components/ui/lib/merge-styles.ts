import type { StyleDesc } from "@gpuix/react";

/**
 * Compose GPUIX style objects, last win, like `cn()` composes classes.
 *
 * Pseudo-state keys (`hover`, `active`) are merged recursively instead of
 * overwritten, so a base hover and a variant hover combine rather than clobber.
 */
export function mergeStyles(
  ...styles: Array<StyleDesc | undefined | null>
): StyleDesc {
  const result: Record<string, unknown> = {};

  for (const style of styles) {
    if (!style) {
      continue;
    }

    for (const key of Object.keys(style) as Array<keyof StyleDesc>) {
      const value = style[key];

      if (value == null) {
        continue;
      }

      if (key === "hover" || key === "active") {
        result[key] = {
          ...(result[key] as Record<string, unknown> | undefined),
          ...(value as Record<string, unknown>),
        };
      } else {
        result[key] = value;
      }
    }
  }

  return result as StyleDesc;
}

/** Conditional style inclusion, mirroring `clsx`. */
export function styleIf(
  condition: boolean | undefined,
  style: StyleDesc,
): StyleDesc | undefined {
  return condition ? style : undefined;
}
