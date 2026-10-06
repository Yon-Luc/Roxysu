import revision from "../upstream/revision.json";
import { isEmptyBeatmap } from "./beatmap";
import { calculateWithSkills } from "./skills/calculator";
import type {
  ManiaBeatmapInput,
  ManiaDifficultyAttributes,
  ManiaDifficultyOptions,
} from "./types";

export type {
  ManiaBeatmapInput,
  ManiaDifficultyAttributes,
  ManiaDifficultyNote,
  ManiaDifficultyOptions,
} from "./types";

export { beatmapFromOsuChart, isEmptyBeatmap } from "./beatmap";
export {
  buildHitObjectGraph,
  ChartMemoryError,
  isChartMemoryError,
  GRAPH_CHECK_EVERY,
} from "./adapters/hitObject";
export type { ManiaDifficultyHitObject, ManiaRow } from "./adapters/hitObject";
export { calculateWithSkills, greatHitWindowForOd } from "./skills/calculator";
export type { SkillStrainSnapshot } from "./skills/calculator";

export {
  expandDanTiers,
  reworkDanIntervalForStar,
  reworkDanIntervalTable,
  reworkDanLabel,
  reworkDanNextTierName,
  reworkDanTableKind,
  reworkDanTierNames,
  reworkDanTiersFor,
  validateDanConfig,
  REWORK_DAN_BANDS,
  REWORK_LN_RATIO_THRESHOLD,
  REWORK_OVER_BAND_PREFIX,
  REWORK_UNDER_BAND_PREFIX,
  REWORK_UNKNOWN_DAN,
} from "./dans";
export type { DanConfig, DanInterval, DanTableKind, DanTierInput } from "./dans";

export {
  dominantSkill,
  isSkillLabel,
  skillStars,
  skillStarsFromBreakdown,
  SECONDARY_SKILL_RATIO,
  SKILL_LABELS,
} from "./skills";
export type { DominantSkill, SkillLabel, SkillStar } from "./skills";

export {
  skillProfile,
  DEFAULT_SKILL_WINDOW_MS,
  MAX_SKILL_WINDOWS,
} from "./skillProfile";
export type { SkillProfile, SkillWindow } from "./skillProfile";

export {
  DiffUtils,
  SQRT2,
} from "../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

export { ColumnPatternUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils";
export { CrossColumnUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/CrossColumnUtils";
export { RunDampenUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils";
export { RootFinding } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding";
export { ChordUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils";
export { TrillUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/TrillUtils";
export { ColumnRunUtils } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnRunUtils";
export { SpeedEvaluator } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator";
export { TechnicalEvaluator } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator";
export { CoordinationEvaluator } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator";
export { JackEvaluator } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator";
export { ReleaseEvaluator } from "../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator";

/**
 * Calculate mania difficulty using generated evaluators + handwritten
 * processor/skill aggregation (matches CreateDifficultyAttributes flow).
 * Pattern-preprocessor manipulation/endurance still default to 1.0.
 */
export function calculateManiaDifficulty(
  beatmap: ManiaBeatmapInput,
  options?: ManiaDifficultyOptions,
): ManiaDifficultyAttributes {
  const provenance = {
    upstreamSha: revision.sha,
    generatorVersion: revision.generatorVersion,
  };

  if (isEmptyBeatmap(beatmap)) {
    return { starRating: 0, noteCount: 0, holdNoteCount: 0, ...provenance };
  }

  const result = calculateWithSkills(beatmap, {
    clockRate: options?.clockRate ?? 1,
  });

  return { ...result, ...provenance };
}
