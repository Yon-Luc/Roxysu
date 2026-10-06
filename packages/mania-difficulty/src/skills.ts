/**
 * Dominant-skill classification for a chart.
 *
 * The rework calculator already reports one star value per skill. A chart's
 * "pattern" is the skill it leans on hardest, with the runner-up kept when it
 * is close enough to matter.
 */

import type { ManiaDifficultyAttributes } from "./types";

/** Skill labels, in canonical tie-break order (earlier wins a tie). */
export const SKILL_LABELS = [
  "speed",
  "jack",
  "coordination",
  "technical",
  "release",
] as const;

export type SkillLabel = (typeof SKILL_LABELS)[number];

/** Skill label → difficulty attribute key. */
const SKILL_ATTRIBUTE = {
  speed: "speedDifficulty",
  jack: "jackDifficulty",
  coordination: "coordinationDifficulty",
  technical: "technicalDifficulty",
  release: "releaseDifficulty",
} as const satisfies Record<SkillLabel, keyof ManiaDifficultyAttributes>;

/** Attribute key → skill label, for reading a stored breakdown back. */
const ATTRIBUTE_SKILL: Record<string, SkillLabel> = Object.fromEntries(
  (Object.keys(SKILL_ATTRIBUTE) as SkillLabel[]).map((skill) => [
    SKILL_ATTRIBUTE[skill],
    skill,
  ]),
);

export type SkillStar = { skill: SkillLabel; star: number };

/** Runner-up must reach this share of the top skill to count as secondary. */
export const SECONDARY_SKILL_RATIO = 0.85;

export type DominantSkill = {
  dominant: SkillLabel | null;
  /** Runner-up when it is at least {@link SECONDARY_SKILL_RATIO} of the top. */
  secondary: SkillLabel | null;
  /** 0 = two skills tied, 1 = a single skill dominates. Null when no skill scored. */
  confidence: number | null;
  /** Every skill that scored, sorted highest first. */
  skills: SkillStar[];
};

/** Skill star values present on a calculator result, sorted highest first. */
export function skillStars(
  attributes: ManiaDifficultyAttributes,
): SkillStar[] {
  return SKILL_LABELS.map((skill) => {
    const value = attributes[SKILL_ATTRIBUTE[skill]];
    return { skill, star: typeof value === "number" ? value : 0 };
  }).sort((a, b) => {
    if (b.star !== a.star) return b.star - a.star;
    // Stable tie-break by canonical order.
    return SKILL_LABELS.indexOf(a.skill) - SKILL_LABELS.indexOf(b.skill);
  });
}

/** Classify a chart's pattern from its skill star values. */
export function dominantSkill(
  attributes: ManiaDifficultyAttributes,
): DominantSkill {
  const skills = skillStars(attributes);
  const top = skills[0];
  if (!top || top.star <= 0) {
    return { dominant: null, secondary: null, confidence: null, skills };
  }

  const runnerUp = skills[1];
  const secondary =
    runnerUp && runnerUp.star >= SECONDARY_SKILL_RATIO * top.star
      ? runnerUp.skill
      : null;

  const confidence =
    runnerUp && runnerUp.star > 0
      ? Math.min(1, Math.max(0, (top.star - runnerUp.star) / top.star))
      : 1;

  return { dominant: top.skill, secondary, confidence, skills };
}

/** Rebuild skill stars from a stored breakdown keyed by attribute name. */
export function skillStarsFromBreakdown(
  breakdown: Record<string, number> | null | undefined,
): SkillStar[] {
  if (!breakdown) return [];
  return Object.entries(breakdown)
    .filter(([key]) => key in ATTRIBUTE_SKILL)
    .map(([key, star]) => ({ skill: ATTRIBUTE_SKILL[key]!, star }))
    .sort((a, b) => {
      if (b.star !== a.star) return b.star - a.star;
      return SKILL_LABELS.indexOf(a.skill) - SKILL_LABELS.indexOf(b.skill);
    });
}

/** True when `value` is one of the five skill labels. */
export function isSkillLabel(value: string): value is SkillLabel {
  return (SKILL_LABELS as readonly string[]).includes(value);
}