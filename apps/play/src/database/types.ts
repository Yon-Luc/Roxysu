export type BeatmapSummary = {
  id: string;
  setId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  rulesetShortName: string | null;
  starRating: number;
  bpm: number;
  length: number;
  hash: string | null;
  audioFileHash: string | null;
  backgroundFileHash: string | null;
  keyCount: number | null;
  overallDifficulty: number | null;
};

export type BeatmapSearchFilters = {
  ruleset?: string;
  keys?: number;
  query?: string;
  beatmapIds?: string[];
  limit?: number;
  offset?: number;
};

export type MasterySummary = {
  beatmapId: string;
  level: number;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  lastPlayedAt: Date | null;
  formulaId: string;
};

export type PatternAnalysisSummary = {
  beatmapId: string;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  confidence: number | null;
};

export type ManiaRatingSummary = {
  beatmapId: string;
  starRating: number | null;
  starRatingSs: number | null;
  ppSs: number | null;
};

export type DanRatingSummary = {
  beatmapId: string;
  estDiff: string | null;
  sunnyStar: number | null;
};

export type BeatmapInsights = {
  beatmapId: string;
  mastery: MasterySummary | null;
  pattern: PatternAnalysisSummary | null;
  maniaRating: ManiaRatingSummary | null;
  danRating: DanRatingSummary | null;
};

export type CollectionKind = "smart" | "realm";

export type CollectionSummary = {
  kind: CollectionKind;
  id: string;
  name: string;
  mapCount: number | null;
  query?: string;
};

export type ScoreSummary = {
  id: string;
  beatmapId: string | null;
  totalScore: number;
  accuracy: number;
  maxCombo: number;
  rank: number;
  playedAt: Date;
  rulesetShortName: string | null;
};

export type RoxysuAvailability =
  | {
      status: "unavailable";
      dbPath: string;
      reason: "db_missing" | "db_unreadable";
      message: string;
    }
  | {
      status: "empty";
      dbPath: string;
      message: string;
    }
  | {
      status: "ready";
      dbPath: string;
      beatmapCount: number;
      maniaBeatmapCount: number;
      mania7kBeatmapCount: number;
    };
