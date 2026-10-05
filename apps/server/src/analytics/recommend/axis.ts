import type { AxisThresholds } from "./axisThresholds";
import { DEFAULT_AXIS_THRESHOLDS } from "./axisThresholds";
import type { MapAxis } from "./types";

/** Classify a map into Rice / LN / full-LN for recommendations. */
export function classifyMapAxis(
  lnRatio: number | null,
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
): MapAxis {
  const ratio = lnRatio ?? 0;
  if (ratio >= thresholds.fln) return "fln";
  if (ratio >= thresholds.ln) return "ln";
  return "rc";
}

export function axisLabel(axis: MapAxis | "overall" | null | undefined): string {
  if (axis === "fln") return "FLN";
  if (axis === "ln") return "LN";
  if (axis === "rc") return "Rice";
  return "Rice/LN/FLN";
}
