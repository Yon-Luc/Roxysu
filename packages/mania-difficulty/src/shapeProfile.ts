/**
 * Chart-shape profile for one mania chart.
 *
 * The walk runs inside `calculateWithSkills` while the row graph is alive, so
 * callers that already rate the chart should read `attributes.shape` instead
 * of calling this again.
 */

import type { ManiaBeatmapInput } from "./types";
import { calculateWithSkills } from "./skills/calculator";
import { emptyShapeProfile, type ShapeProfile } from "./shape";

export function shapeProfile(
  beatmap: ManiaBeatmapInput,
  options?: { clockRate?: number },
): ShapeProfile {
  if (beatmap.notes.length === 0) return emptyShapeProfile();
  const attributes = calculateWithSkills(beatmap, {
    clockRate: options?.clockRate ?? 1,
  });
  return attributes.shape ?? emptyShapeProfile();
}
