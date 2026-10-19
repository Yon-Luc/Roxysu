export type BmsScoreRow = {
  id: string;
  playedAt?: number;
  achievedAt?: string;
  beatmapId?: string | null;
  title: string | null;
  artist: string | null;
  difficulty?: string | null;
  chartMd5?: string | null;
  md5?: string | null;
  backgroundFileHash?: string | null;
  setOnlineId?: number | null;
  exScore: number | null;
  maxExScore: number | null;
  normalizedScore: number | null;
  accuracy: number | null;
  pgreat?: number | null;
  great?: number | null;
  good?: number | null;
  bad?: number | null;
  poor?: number | null;
  miss?: number | null;
  variantId: string;
  gaugeId: string | null;
  comboLampId: string | null;
  clearLampId: string | null;
  djGrade: string | null;
};

export type BmsVariantCount = { variantId: string; plays: number };

export type BmsSessionRow = {
  startedAt: number | string;
  endedAt: number | string;
  scoreCount: number;
  titles: string[];
};

export type BmsTableLevel = {
  level: string;
  index?: number;
  levelIndex?: number;
  total: number;
  cleared: number;
};

export type BmsTableBlock = {
  tableId: string;
  versionId: string;
  name: string;
  symbol: string;
  unresolvedCount: number;
  levels: BmsTableLevel[];
};

export type BmsSyncStatus = {
  autoUpload: boolean;
  historicalUpload: boolean;
  backfill: string;
  authPaused: boolean;
  loggedIn: boolean;
  counts: {
    pending: number;
    uploading: number;
    retryWait: number;
    synced: number;
    rejected: number;
  };
};

export const BMS_ACHIEVEMENTS = ["aa", "aaa", "max", "a", "fc", "perfect", "max-lamp"] as const;

export const BMS_GAUGES = [
  "assist_easy",
  "easy",
  "normal",
  "hard",
  "ex_hard",
  "hazard",
  "class",
  "ex_class",
  "ex_hard_class",
] as const;

export type BmsLeaderRow = {
  rank: number;
  id: string;
  username: string;
  countryCode: string | null;
  exScore: number | null;
  maxExScore: number | null;
  accuracy: number | null;
  djGrade: string | null;
  comboLampId: string | null;
  gaugeId: string | null;
  variantId: string;
  achievedAt: string;
};

export type BmsChartInfo = {
  md5: string;
  sha256: string | null;
  title: string | null;
  artist: string | null;
  keyCount: number | null;
  trust: string;
  variants: Array<{ variantId: string; plays: number; players: number }>;
};

export type BmsFeedScore = {
  id: string;
  createdAt: string;
  achievedAt: string;
  chartMd5: string;
  title: string | null;
  artist: string | null;
  username: string;
  countryCode: string | null;
  exScore: number | null;
  maxExScore: number | null;
  accuracy: number | null;
  variantId: string;
  gaugeId: string | null;
  comboLampId: string | null;
  djGrade: string | null;
  trust: string;
};

export type BmsGlobalStats = {
  uniqueScores: number;
  recordedSubmissions: number;
  acceptedSubmissions: number;
  rejectedSubmissions: number;
  activePlayers: number;
  definitions: {
    uniqueScores: string;
    recordedSubmissions: string;
    activePlayers: string;
    timeseries: string;
  };
};

export type BmsDayPoint = { day: string; plays: number };
