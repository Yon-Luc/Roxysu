import type {
  RecommendFocus,
  SevenKSkillProfile,
  SkillAxis,
} from "./types";
import { axisLabel } from "./axis";

export function formatSunny(n: number): string {
  return n.toFixed(1);
}

function axisFilterLabel(skillset: SkillAxis | null): string {
  return axisLabel(skillset);
}

export function summaryFor(
  focus: RecommendFocus,
  skillset: SkillAxis | null,
  skill: SevenKSkillProfile,
  count: number,
): string {
  const axisNote =
    focus === "deficit" ? "" : ` (${axisFilterLabel(skillset)})`;
  const focusLabel =
    focus === "skillset"
      ? `${axisFilterLabel(skillset)} practice`
      : focus === "consistency"
        ? "consistency/accuracy improvement"
        : focus === "accuracy"
          ? "99%+ accuracy targets"
          : focus === "push"
            ? "pushing limits"
            : focus === "deficit"
              ? "fixing weak skillsets"
              : "general";

  if (skill.overall <= 0) {
    return "Not enough 7K Sunny-rated plays to estimate skill yet. Play more 7K maps or run Sunny dan backfill in Settings.";
  }

  const cold = skill.coldStart ? " (cold start)" : "";
  if (focus === "push") {
    return `Found ${count} maps for pushing above your 90–95% clear level (~${formatSunny(skill.peakOverall)} Sunny)${axisNote}${cold}`;
  }
  if (focus === "accuracy") {
    return `Found ${count} maps in your 99%+ difficulty range (~${formatSunny(skill.accuracyOverall)} Sunny)${axisNote}${cold}`;
  }
  if (focus === "consistency") {
    return `Found ${count} maps around your 96–99% level (~${formatSunny(skill.consistencyOverall)} Sunny)${axisNote}${cold}`;
  }
  return `Found ${count} maps for ${focusLabel} at skill level ${formatSunny(skill.overall)}${cold}`;
}
