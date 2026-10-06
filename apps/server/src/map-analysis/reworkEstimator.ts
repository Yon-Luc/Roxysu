import { parseOsuChart } from "@roxysu/osu-chart";
import {
  reworkDanLabel,
  skillProfile,
  type SkillLabel,
  type SkillStar,
} from "@roxysu/mania-difficulty";
import { noteDensities } from "@roxysu/mania-pattern-analysis";
import type { ChartNote } from "@roxysu/osu-chart";

/** Estimator id stored in the Sunny dan ratings store. */
export const REWORK_ALGORITHM = "mania-difficulty";

export type ReworkDanValues = {
  star: number;
  lnRatio: number;
  columnCount: number;
  estDiff: string;
  overallDifficulty: number;
  /** Per-skill star ratings, highest first. */
  skills: SkillStar[];
};

export type ReworkPatternValues = {
  columnCount: number;
  dominantPattern: SkillLabel | null;
  secondaryPattern: SkillLabel | null;
  confidence: number | null;
  jackDensity: number;
  chordDensity: number;
  streamDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  jumpstreamScore: number;
  chordstreamScore: number;
};

export type ReworkEstimatorResult = ReworkDanValues & {
  /** Present only when the skill profile was requested (pattern analysis). */
  pattern: ReworkPatternValues | null;
};

export type ReworkPatternSummary = {
  dominant: SkillLabel | null;
  secondary: SkillLabel | null;
  confidence: number | null;
  skills: SkillStar[];
  starRating: number;
  lnRatio: number;
  columnCount: number;
  overallDifficulty: number;
};

function overallDifficultyFrom(metaData: Record<string, string>): number {
  const raw = Number(metaData["OverallDifficulty"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
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

function toInput(chart: { columnCount: number; notes: ChartNote[] }, od: number) {
  return {
    columnCount: chart.columnCount,
    overallDifficulty: od,
    notes: chart.notes.map((n) => ({
      column: n.column,
      startMs: n.startMs,
      endMs: n.endMs,
    })),
  };
}

function danValues(
  attributes: {
    starRating: number;
    lnRatio?: number;
  },
  columnCount: number,
  lnRatioFallback: number,
  overallDifficulty: number,
  skills: SkillStar[],
): ReworkDanValues {
  const lnRatio = attributes.lnRatio ?? lnRatioFallback;
  return {
    star: attributes.starRating,
    lnRatio,
    columnCount,
    estDiff: reworkDanLabel(attributes.starRating, lnRatio, columnCount),
    overallDifficulty,
    skills,
  };
}

/**
 * Rate one chart and classify its dominant skill in a **single** calculator pass.
 *
 * The dan row and the pattern row need the same skills, so callers should prefer
 * this over `runReworkEstimatorFromText` + `analyzeManiaSkillNotes`, which would
 * parse the chart and run the calculator twice.
 *
 * Omit `options.windowMs` to skip the time-binned skill profile when only the
 * star rating and dan label are needed.
 */
export function analyzeManiaOnceFromText(
  osuText: string,
  options: {
    clockRate?: number;
    /** Compute the dominant-skill row too. Default false. */
    withPattern?: boolean;
    /**
     * Bin width for the skill timeline. Only the preview/detail surface sets
     * this; backfills leave it unset so no per-chart window array is allocated.
     */
    windowMs?: number;
    /** Backfill guard. Omitted for a single on-request read. */
    shouldContinue?: () => boolean;
  } = {},
): ReworkEstimatorResult {
  const chart = parseManiaChart(osuText);
  const overallDifficulty = overallDifficultyFrom(chart.metaData);
  const beatmap = toInput(chart, overallDifficulty);
  const withPattern = options.withPattern === true;

  if (!withPattern) {
    // Dan-only path: no per-note snapshots, no profile binning.
    const profile = skillProfile(beatmap, {
      clockRate: options.clockRate ?? 1,
      windowMs: null,
      shouldContinue: options.shouldContinue,
    });
    return {
      ...danValues(
        profile.attributes,
        chart.columnCount,
        chart.lnRatio,
        overallDifficulty,
        profile.skills,
      ),
      pattern: null,
    };
  }

  const profile = skillProfile(beatmap, {
    clockRate: options.clockRate ?? 1,
    // Chart-level classification unless the caller wants the timeline.
    windowMs: options.windowMs ?? null,
    shouldContinue: options.shouldContinue,
  });
  const densities = noteDensities(chart.notes);
  return {
    ...danValues(
      profile.attributes,
      chart.columnCount,
      chart.lnRatio,
      overallDifficulty,
      profile.skills,
    ),
    pattern: {
      columnCount: chart.columnCount,
      dominantPattern: profile.dominant,
      secondaryPattern: profile.secondary,
      confidence: profile.confidence,
      ...densities,
    },
  };
}

/**
 * Rework star rating and dan label only — skips the time-binned profile.
 */
export function runReworkEstimatorFromText(
  osuText: string,
  options: { speedRate?: number; clockRate?: number } = {},
): Omit<ReworkEstimatorResult, "pattern"> {
  const result = analyzeManiaOnceFromText(osuText, {
    clockRate: options.clockRate ?? options.speedRate ?? 1,
  });
  const { pattern: _pattern, ...dan } = result;
  return dan;
}