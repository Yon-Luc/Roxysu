/** Companella-style focus modes adapted for 7K Sunny difficulty. */
export type RecommendFocus =
  | "push"
  | "consistency"
  | "deficit"
  | "skillset";

/** 7K skill axes (RC vs LN via Sunny ln_ratio threshold). */
export type SkillAxis = "rc" | "ln" | "overall";

export type SevenKSkillProfile = {
  /** Comfort / volume-weighted skill (good for Consistency). */
  overall: number;
  rc: number;
  ln: number;
  /**
   * Push baseline: average Sunny of maps with scores in the 90–95% band
   * (dan-style clear level), per axis. Field names kept as peak* for API stability.
   */
  peakOverall: number;
  peakRc: number;
  peakLn: number;
  /** Distinct maps contributing to the 90–95% clear average. */
  clearRcMaps: number;
  clearLnMaps: number;
  /** Scores with Sunny used in the comfort estimate. */
  samplePlays: number;
  rcPlays: number;
  lnPlays: number;
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
  summary: string;
  totalMapsConsidered: number;
  needsSunnyBackfill: boolean;
  recommendations: RecommendItem[];
};
