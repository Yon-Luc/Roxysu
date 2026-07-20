export {
  analyze7kHeuristicFromOsuText,
  analyze7kHeuristicNotes,
} from "./heuristic-v1/analyze7kHeuristic";
export {
  analyze7kStructuralFromOsuText,
  analyze7kStructuralNotes,
} from "./structural-v2/analyze7kStructural";
export {
  PATTERN_ALGORITHM,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  PATTERN_LABELS_V1,
  PATTERN_LABELS_V2,
} from "./types";
export type {
  ChartNote,
  PatternAnalysisResult,
  PatternComposition,
  PatternLabel,
  PatternLabelV1,
  PatternLabelV2,
  PatternMetrics,
  PatternSection,
  StructuralPatternResult,
} from "./types";

import type { PatternAnalysisResult } from "./types";
import { analyze7kHeuristicFromOsuText } from "./heuristic-v1/analyze7kHeuristic";
import { analyze7kHeuristicNotes } from "./heuristic-v1/analyze7kHeuristic";
import { analyze7kStructuralFromOsuText } from "./structural-v2/analyze7kStructural";
import {
  PATTERN_ALGORITHM,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
} from "./types";

/** Run pattern analysis for a registered algorithm id. */
export function analyze7kFromOsuText(
  osuText: string,
  algorithm: string = PATTERN_ALGORITHM,
): PatternAnalysisResult {
  switch (algorithm) {
    case PATTERN_ALGORITHM_V1:
      return analyze7kHeuristicFromOsuText(osuText);
    case PATTERN_ALGORITHM_V2:
      return analyze7kStructuralFromOsuText(osuText);
    default:
      throw new Error(`Unknown pattern algorithm: ${algorithm}`);
  }
}

/** Backward-compatible aliases for the previous server API. */
export { analyze7kHeuristicNotes as analyze7kNotes };

export const PATTERN_LABELS = [
  "jack",
  "jumpstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "delay",
  "mixed",
] as const;
