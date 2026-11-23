import type {
  PlayerStats,
  StatsSkillAxis,
} from "../../lib/api";
import {
  formatSkillRating,
  type RatingDisplayMode,
  type SkillRatingAxis,
} from "../../lib/ratingDisplay";
import type { Dictionary } from "@roxysu/i18n";

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function skillAxisLabel(
  dict: Dictionary["app"] | undefined,
  axis: StatsSkillAxis,
): string {
  switch (axis) {
    case "rc":
      return dict?.stats.axisRice ?? "Rice";
    case "ln":
      return dict?.stats.axisLn ?? "LN";
    case "fln":
      return dict?.stats.axisFln ?? "FLN";
    default:
      return dict?.stats.axisAll ?? "All";
  }
}

export function skillRatingAxis(axis: StatsSkillAxis): SkillRatingAxis {
  if (axis === "rc" || axis === "ln" || axis === "fln") return axis;
  return "overall";
}

export function skillBandValue(
  skill: PlayerStats["skill"],
  band: "peak" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  const values = {
    peak: {
      all: skill.peakOverall,
      rc: skill.peakRc,
      ln: skill.peakLn,
      fln: skill.peakFln,
    },
    accuracy: {
      all: skill.accuracyOverall,
      rc: skill.accuracyRc,
      ln: skill.accuracyLn,
      fln: skill.accuracyFln,
    },
    consistency: {
      all: skill.consistencyOverall,
      rc: skill.consistencyRc,
      ln: skill.consistencyLn,
      fln: skill.consistencyFln,
    },
  } as const;
  if (axis === "all") return values[band].all;
  return values[band][axis];
}

export function skillBandMaps(
  skill: PlayerStats["skill"],
  band: "peak" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  const values = {
    peak: {
      all: skill.clearRcMaps + skill.clearLnMaps + skill.clearFlnMaps,
      rc: skill.clearRcMaps,
      ln: skill.clearLnMaps,
      fln: skill.clearFlnMaps,
    },
    accuracy: {
      all: skill.accuracyRcMaps + skill.accuracyLnMaps + skill.accuracyFlnMaps,
      rc: skill.accuracyRcMaps,
      ln: skill.accuracyLnMaps,
      fln: skill.accuracyFlnMaps,
    },
    consistency: {
      all:
        skill.consistencyRcMaps +
        skill.consistencyLnMaps +
        skill.consistencyFlnMaps,
      rc: skill.consistencyRcMaps,
      ln: skill.consistencyLnMaps,
      fln: skill.consistencyFlnMaps,
    },
  } as const;
  return values[band][axis];
}

export const SKILL_EVOLUTION_BANDS = ["push", "accuracy", "consistency"] as const;

export type SkillEvolutionBand = (typeof SKILL_EVOLUTION_BANDS)[number];

export type SkillEvolutionPoint = {
  push: number | null;
  accuracy: number | null;
  consistency: number | null;
};

export function isSkillEvolutionBand(value: unknown): value is SkillEvolutionBand {
  return (
    value === "push" || value === "accuracy" || value === "consistency"
  );
}

function finiteBandValues(
  points: readonly SkillEvolutionPoint[],
  bands: readonly SkillEvolutionBand[],
): number[] {
  const values: number[] = [];
  for (const point of points) {
    for (const band of bands) {
      const value = point[band];
      if (value != null && Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/** Keep the min/max strokes inside the plot box instead of on its edge. */
const DOMAIN_PAD_FRACTION = 0.05;
const DOMAIN_PAD_MIN = 0.05;

function domainFromValues(values: readonly number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [min, min + 1];
  const pad = Math.max((max - min) * DOMAIN_PAD_FRACTION, DOMAIN_PAD_MIN);
  // Skills are non-negative: never pad the floor below zero.
  return [Math.max(0, min - pad), max + pad];
}

/**
 * Focus toggle for Skill evolution. A band with no finite points is never
 * isolated: focusing it would hide every other line and leave the chart
 * empty (its domain falls back to the combined range of lines that are no
 * longer drawn), so such a click is ignored.
 */
export function nextSkillFocus(
  current: SkillEvolutionBand | null,
  clicked: SkillEvolutionBand,
  points: readonly SkillEvolutionPoint[],
): SkillEvolutionBand | null {
  if (finiteBandValues(points, [clicked]).length === 0) return current;
  return current === clicked ? null : clicked;
}

/** Y-axis extent for Skill evolution. Floor is the lowest plotted skill level. */
export function skillEvolutionDomain(
  points: readonly SkillEvolutionPoint[],
  focus: SkillEvolutionBand | null,
): [number, number] {
  const focused = finiteBandValues(
    points,
    focus ? [focus] : SKILL_EVOLUTION_BANDS,
  );
  if (focused.length > 0) return domainFromValues(focused);
  if (focus) {
    const combined = finiteBandValues(points, SKILL_EVOLUTION_BANDS);
    if (combined.length > 0) return domainFromValues(combined);
  }
  return [0, 1];
}

export function historyBandValue(
  point: NonNullable<PlayerStats["skillHistory"]>[number],
  band: "push" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number | null {
  if (axis === "all") return point[band] > 0 ? point[band] : null;
  const key = `${band}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as
    | "pushRc"
    | "pushLn"
    | "pushFln"
    | "accuracyRc"
    | "accuracyLn"
    | "accuracyFln"
    | "consistencyRc"
    | "consistencyLn"
    | "consistencyFln";
  const axisValue = point[key];
  return axisValue > 0 ? axisValue : null;
}

export function skillTooltipFormatter(
  mode: RatingDisplayMode,
  value: unknown,
  name: unknown,
  axis: StatsSkillAxis,
): [string, string] {
  const label = String(name ?? "");
  if (value == null || value === "") return ["—", label];
  const n = typeof value === "number" ? value : Number(value);
  return [
    formatSkillRating({
      mode,
      reworkStar: n,
      axis: skillRatingAxis(axis),
    }),
    label,
  ];
}
