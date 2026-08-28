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
};

export type BeatmapSearchFilters = {
  ruleset?: string;
  keys?: number;
  query?: string;
  limit?: number;
  offset?: number;
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
