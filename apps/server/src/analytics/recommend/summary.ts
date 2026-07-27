import type {
  RecommendFocus,
  SevenKSkillProfile,
  SkillAxis,
} from "./types";
import { axisLabel } from "./axis";
import { skillForAxis } from "./sevenKSkill";

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
  topPlays = 30,
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
  const axis = skillset;

  if (focus === "push") {
    const level = skillForAxis(skill, axis, "peak");
    if (level <= 0) {
      return `Need at least ${topPlays} maps with 90%+ clears in your top ${topPlays} rated maps${axisNote} before push recommendations are available.`;
    }
    return `Found ${count} maps for pushing above your 90%+ clear level (~${formatSunny(level)} Sunny)${axisNote}${cold}`;
  }
  if (focus === "accuracy") {
    const level = skillForAxis(skill, axis, "accuracy");
    if (level <= 0) {
      return `Need at least ${topPlays} maps with 99%+ clears in your top ${topPlays} rated maps${axisNote} before accuracy recommendations are available.`;
    }
    return `Found ${count} maps in your 99%+ difficulty range (~${formatSunny(level)} Sunny)${axisNote}${cold}`;
  }
  if (focus === "consistency") {
    const level = skillForAxis(skill, axis, "consistency");
    if (level <= 0) {
      return `Need at least ${topPlays} maps with 96%+ clears in your top ${topPlays} rated maps${axisNote} before consistency recommendations are available.`;
    }
    return `Found ${count} maps around your 96%+ level (~${formatSunny(level)} Sunny)${axisNote}${cold}`;
  }
  return `Found ${count} maps for ${focusLabel} at skill level ${formatSunny(skill.overall)}${cold}`;
}
