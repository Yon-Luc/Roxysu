import { parseOsuChart } from "@roxysu/osu-chart";
import { findAllPatterns } from "./engine.js";
import { parseOsuFile } from "./osuParser.js";
import type { PatternAnalysisResult as InterludeResult } from "./types.js";
import {
  adaptInterludeResult,
  analyzeManiaStructuralFromOsuText,
  analyzeManiaStructuralNotes,
  chartNotesToHitObjects,
} from "./adaptRoxysu.js";
import {
  analyzeManiaSkillFromOsuText,
  analyzeManiaSkillNotes,
  noteDensities,
  overallDifficultyFrom,
} from "./skillAnalysis.js";
import {
  PATTERN_ALGORITHM,
  PATTERN_ALGORITHM_INTERLUDE,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  type PatternAnalysisResult,
  type StructuralPatternResult,
} from "./roxysuTypes.js";

export {
  adaptInterludeResult,
  analyzeManiaStructuralFromOsuText,
  analyzeManiaStructuralNotes,
  chartNotesToHitObjects,
  analyzeManiaSkillFromOsuText,
  analyzeManiaSkillNotes,
  noteDensities,
  overallDifficultyFrom,
};

/** Convenience helper matching PatternFinder.FindAllPatterns(OsuFile). */
export function findAllPatternsFromOsuFile(
  fileContents: string,
): InterludeResult {
  const { circleSize, hitObjects } = parseOsuFile(fileContents);
  return findAllPatterns(hitObjects, circleSize);
}

function parseManiaChart(osuText: string) {
  const chart = parseOsuChart(osuText);
  if (chart.status === "NotMania" || chart.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (chart.status === "Fail" || chart.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }
  return chart;
}

/** Run pattern analysis for a registered algorithm id. */
export function analyzeManiaFromOsuText(
  osuText: string,
  algorithm: string = PATTERN_ALGORITHM,
): StructuralPatternResult {
  switch (algorithm) {
    case PATTERN_ALGORITHM_V1:
    case PATTERN_ALGORITHM_V2:
    case PATTERN_ALGORITHM_INTERLUDE:
      throw new Error(
        `Legacy pattern algorithm ${algorithm} is no longer supported; use ${PATTERN_ALGORITHM}`,
      );
    case PATTERN_ALGORITHM:
    default:
      if (algorithm !== PATTERN_ALGORITHM) {
        throw new Error(`Unknown pattern algorithm: ${algorithm}`);
      }
      return analyzeManiaSkillFromOsuText(
        osuText,
        parseManiaChart(osuText).columnCount,
      );
  }
}

/**
 * Backfill entry point: dominant skill plus note-structural densities only.
 *
 * Must not bin the skill timeline. `analyzeManiaSkillNotes` treats an omitted
 * `windowMs` as "use the default width", so the argument is passed as `null`
 * explicitly here — otherwise every backfilled map allocates a window array it
 * never stores, and the loop that builds them is the one that can exhaust the
 * heap. Use `analyzeManiaFromOsuText` directly for the on-request timeline.
 */
export function analyzeManiaBackfillFromOsuText(
  osuText: string,
  algorithm: string = PATTERN_ALGORITHM,
  shouldContinue?: () => boolean,
): StructuralPatternResult {
  if (algorithm !== PATTERN_ALGORITHM) {
    throw new Error(`Unknown pattern algorithm: ${algorithm}`);
  }
  const chart = parseManiaChart(osuText);
  return analyzeManiaSkillNotes(
    chart.notes,
    chart.columnCount,
    overallDifficultyFrom(chart),
    null,
    shouldContinue,
  );
}

/** Analyze parsed mania chart notes with the active algorithm. */
export function analyzeManiaNotes(
  notes: Parameters<typeof analyzeManiaSkillNotes>[0],
  keyCount: number,
  algorithm: string = PATTERN_ALGORITHM,
  overallDifficulty = 8,
): PatternAnalysisResult {
  if (algorithm !== PATTERN_ALGORITHM) {
    throw new Error(`Unknown pattern algorithm: ${algorithm}`);
  }
  return analyzeManiaSkillNotes(notes, keyCount, overallDifficulty);
}

export type { StructuralPatternResult };