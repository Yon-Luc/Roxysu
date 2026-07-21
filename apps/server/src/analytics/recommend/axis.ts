import {
  FLN_RATIO_THRESHOLD,
  LN_DAN_RATIO_THRESHOLD,
} from "../../map-analysis/estDiff";
import type { MapAxis } from "./types";

/** Classify a map into Rice / LN / full-LN for recommendations. */
export function classifyMapAxis(lnRatio: number | null): MapAxis {
  const ratio = lnRatio ?? 0;
  if (ratio >= FLN_RATIO_THRESHOLD) return "fln";
  if (ratio >= LN_DAN_RATIO_THRESHOLD) return "ln";
  return "rc";
}

export function axisLabel(axis: MapAxis | "overall" | null | undefined): string {
  if (axis === "fln") return "FLN";
  if (axis === "ln") return "LN";
  if (axis === "rc") return "Rice";
  return "Rice/LN/FLN";
}
