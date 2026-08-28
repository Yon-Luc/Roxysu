import type { RenderOptions } from "@gpuix/react";

/** `focus` is documented in gpuix main but not yet in @gpuix/react@0.5.1 types. */
export type RenderOptionsWithFocus = RenderOptions & { focus?: boolean };

/**
 * Shared `render()` options for Roxysu Play.
 *
 * Respects `GPUIX_BACKGROUND=1` so agent/automation runs open behind the
 * editor (macOS/Windows). Linux ignores `focus` — see GPUIX_CONSTRAINTS.md.
 */
export function gpuixRenderOptions(
  overrides: RenderOptionsWithFocus = {},
): RenderOptionsWithFocus {
  return {
    focus: process.env.GPUIX_BACKGROUND !== "1",
    ...overrides,
  };
}
