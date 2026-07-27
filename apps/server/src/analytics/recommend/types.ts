/** Companella-style focus modes adapted for 7K Sunny difficulty. */
export type RecommendFocus =
  | "push"
  | "accuracy"
  | "consistency"
  | "deficit"
  | "skillset";

/** API skillset filter (pool limit); distinct from SkillAxis used in matching. */
export type RecommendSkillsetFilter = "both" | "rc" | "ln" | "fln";

/**
 * 7K skill axes via Sunny ln_ratio:
 * - rc: &lt;20% LN
 * - ln: 20–80% LN
 * - fln: ≥80% LN (full LN)
 */
export type SkillAxis = "rc" | "ln" | "fln" | "overall";

/** Map-classification axes (no overall). */
export type MapAxis = "rc" | "ln" | "fln";

export type SevenKSkillProfile = {
  /** Comfort / volume-weighted skill (Deficit / Skillset fallback). */
  overall: number;
  rc: number;
  ln: number;
  fln: number;
  /**
   * Push baseline: average Sunny of maps with scores in the 90–95% band.
   */
  peakOverall: number;
  peakRc: number;
  peakLn: number;
  peakFln: number;
  /** Distinct maps contributing to the 90–95% clear average. */
  clearRcMaps: number;
  clearLnMaps: number;
  clearFlnMaps: number;
  /**
   * Accuracy baseline: average Sunny of maps with scores at 99%+.
   */
  accuracyOverall: number;
  accuracyRc: number;
  accuracyLn: number;
  accuracyFln: number;
  accuracyRcMaps: number;
  accuracyLnMaps: number;
  accuracyFlnMaps: number;
  /**
   * Consistency baseline: average Sunny of maps with scores in the 96–99% band.
   */
  consistencyOverall: number;
  consistencyRc: number;
  consistencyLn: number;
  consistencyFln: number;
  consistencyRcMaps: number;
  consistencyLnMaps: number;
  consistencyFlnMaps: number;
  /** Scores with Sunny used in the comfort estimate. */
  samplePlays: number;
  rcPlays: number;
  lnPlays: number;
  flnPlays: number;
  /** True when estimate used a cold-start fallback. */
  coldStart: boolean;
};

export type MapMatchResult = {
  beatmapId: string;
  mmr: number;
  relativeDifficulty: number;
  confidence: number;
  sunnyStar: number;
  lnRatio: number | null;
  axis: SkillAxis;
  bestAccuracy: number | null;
  playCount: number;
  lastPlayedAt: number | null;
};

export type RecommendItem = MapMatchResult & {
  focus: RecommendFocus;
  targetSkillset: SkillAxis | null;
  reasoning: string;
  // Practice card fields
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  onlineId: number | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
  bestPp: number | null;
  bestScore: number | null;
  bestMisses: number | null;
  masteryLevel: number | null;
  sunnyEstDiff: string | null;
};

export type RecommendBatch = {
  focus: RecommendFocus;
  targetSkillset: SkillAxis | null;
  skill: SevenKSkillProfile;
  skillTopPlays: number;
  summary: string;
  totalMapsConsidered: number;
  needsSunnyBackfill: boolean;
  recommendations: RecommendItem[];
};
