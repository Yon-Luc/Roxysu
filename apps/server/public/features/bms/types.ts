export type BmsScoreRow = {
  id: string;
  playedAt?: number;
  achievedAt?: string;
  beatmapId?: string | null;
  title: string | null;
  artist: string | null;
  difficulty?: string | null;
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
