import { LN_DAN_RATIO_THRESHOLD } from "../../map-analysis/estDiff";
import type { SevenKSkillProfile, SkillAxis, MapMatchResult } from "./types";
import { skillForAxis } from "./sevenKSkill";

const BASE_SUNNY_WEIGHT = 0.6;
const PERFORMANCE_WEIGHT = 0.4;

export type CandidateMap = {
  id: string;
  sunnyStar: number;
  lnRatio: number | null;
  bestAccuracy: number | null;
  playCount: number;
  lastPlayedAt: number | null;
};

function classifyAxis(lnRatio: number | null): "rc" | "ln" {
  return (lnRatio ?? 0) >= LN_DAN_RATIO_THRESHOLD ? "ln" : "rc";
}

/**
 * Performance adjustment from best accuracy on the map (Companella-style).
 * High acc → slightly easier than Sunny suggests; low acc → slightly harder.
 * Accuracy is stored 0–1.
 */
function performanceAdjustment(
  bestAccuracy: number | null,
  playCount: number,
): number {
  if (playCount <= 0 || bestAccuracy == null) return 0;
  const accPct = bestAccuracy * 100;
  if (accPct > 95) return -0.5 * (accPct - 95) / 5;
  if (accPct < 90) return 0.5 * (90 - accPct) / 10;
  return 0;
}

function confidenceFor(
  map: CandidateMap,
  skill: SevenKSkillProfile,
): number {
  let confidence = 0;
  if (map.sunnyStar > 0) confidence += 0.4;
  if (map.playCount > 0) {
    confidence += Math.min(0.3, map.playCount * 0.1);
  }
  if (skill.samplePlays >= 10) confidence += 0.3;
  else if (skill.samplePlays >= 5) confidence += 0.15;
  return Math.min(1, confidence);
}

/**
 * Map-MMR analogue: hybrid Sunny difficulty + personal performance tweak.
 * relativeDifficulty = mmr / playerSkill (1.0 = at level).
 */
export function calculateMapMatch(
  map: CandidateMap,
  skill: SevenKSkillProfile,
  targetSkillset: SkillAxis | null = null,
  skillMode: "comfort" | "peak" | "consistency" = "comfort",
): MapMatchResult {
  const axis: SkillAxis =
    targetSkillset && targetSkillset !== "overall"
      ? targetSkillset
      : classifyAxis(map.lnRatio);

  const baseSunny = map.sunnyStar;
  const adjustment = performanceAdjustment(map.bestAccuracy, map.playCount);
  const adjusted = baseSunny + adjustment;
  const mmr = baseSunny * BASE_SUNNY_WEIGHT + adjusted * PERFORMANCE_WEIGHT;

  const playerSkill = skillForAxis(skill, axis, skillMode);
  const relativeDifficulty =
    playerSkill > 0 ? mmr / playerSkill : 1;

  return {
    beatmapId: map.id,
    mmr,
    relativeDifficulty,
    confidence: confidenceFor(map, skill),
    sunnyStar: baseSunny,
    lnRatio: map.lnRatio,
    axis,
    bestAccuracy: map.bestAccuracy,
    playCount: map.playCount,
    lastPlayedAt: map.lastPlayedAt,
  };
}

export function mapMatchesAxis(
  lnRatio: number | null,
  axis: "rc" | "ln",
): boolean {
  return classifyAxis(lnRatio) === axis;
}
