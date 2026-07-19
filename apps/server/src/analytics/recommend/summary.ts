import type {
  RecommendFocus,
  SevenKSkillProfile,
  SkillAxis,
} from "./types";

export function formatSunny(n: number): string {
  return n.toFixed(1);
}

function axisFilterLabel(skillset: SkillAxis | null): string {
  if (skillset === "ln") return "LN";
  if (skillset === "rc") return "Rice";
  return "Rice/LN";
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
  if (focus === "consistency") {
    return `Found ${count} maps around your 96–99% level (~${formatSunny(skill.consistencyOverall)} Sunny)${axisNote}${cold}`;
  }
  return `Found ${count} maps for ${focusLabel} at skill level ${formatSunny(skill.overall)}${cold}`;
}
