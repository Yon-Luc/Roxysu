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

export function historyBandValue(
  point: NonNullable<PlayerStats["skillHistory"]>[number],
  band: "push" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  if (axis === "all") return point[band];
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
  return axisValue > 0 ? axisValue : point[band];
}

export function skillTooltipFormatter(
  mode: RatingDisplayMode,
  value: unknown,
  name: unknown,
  axis: StatsSkillAxis,
): [string, string] {
  const label = String(name ?? "");
  const n = typeof value === "number" ? value : Number(value);
  return [
    formatSkillRating({
      mode,
      sunnyStar: n,
      axis: skillRatingAxis(axis),
    }),
    label,
  ];
}
