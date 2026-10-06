import { parseOsuChart } from "@roxysu/osu-chart";
import {
  beatmapFromOsuChart,
  calculateManiaDifficulty,
  reworkDanLabel,
  type ManiaDifficultyAttributes,
  type SkillStar,
} from "@roxysu/mania-difficulty";

/** Estimator id stored in the Sunny dan ratings store. */
export const REWORK_ALGORITHM = "mania-difficulty";

export type ReworkEstimatorResult = {
  star: number;
  lnRatio: number;
  columnCount: number;
  estDiff: string;
  overallDifficulty: number;
  /** Per-skill star ratings, highest first. */
  skills: SkillStar[];
};

function overallDifficultyFrom(metaData: Record<string, string>): number {
  const raw = Number(metaData["OverallDifficulty"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}

function skillBreakdown(
  attributes: ManiaDifficultyAttributes,
): SkillStar[] {
  const entries: Array<[SkillStar["skill"], number | undefined]> = [
    ["speed", attributes.speedDifficulty],
    ["jack", attributes.jackDifficulty],
    ["coordination", attributes.coordinationDifficulty],
    ["technical", attributes.technicalDifficulty],
    ["release", attributes.releaseDifficulty],
  ];
  return entries
    .map(([skill, value]) => ({ skill, star: typeof value === "number" ? value : 0 }))
    .sort((a, b) => b.star - a.star);
}

/**
 * Run the mania difficulty port on `.osu` text and map stars → dan label.
 *
 * Dan tiers come from `@roxysu/mania-difficulty`'s `dans.json`; the label is
 * recomputed from the floors on every read, so retuning a floor needs no
 * re-estimate.
 */
export function runReworkEstimatorFromText(
  osuText: string,
  options: { speedRate?: number; clockRate?: number } = {},
): ReworkEstimatorResult {
  const chart = parseOsuChart(osuText);
  if (chart.status === "NotMania" || chart.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (chart.status === "Fail" || chart.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }

  const clockRate = options.clockRate ?? options.speedRate ?? 1;
  const overallDifficulty = overallDifficultyFrom(chart.metaData);
  const attributes = calculateManiaDifficulty(
    beatmapFromOsuChart(chart, overallDifficulty),
    { clockRate },
  );

  if (!Number.isFinite(attributes.starRating)) {
    throw new Error("Invalid estimator output");
  }

  const lnRatio = attributes.lnRatio ?? chart.lnRatio ?? 0;
  return {
    star: attributes.starRating,
    lnRatio,
    columnCount: chart.columnCount,
    estDiff: reworkDanLabel(attributes.starRating, lnRatio, chart.columnCount),
    overallDifficulty,
    skills: skillBreakdown(attributes),
  };
}