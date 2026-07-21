export type TosuConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected";

export type TosuLiveBeatmap = {
  checksum: string | null;
  onlineId: number | null;
  setOnlineId: number | null;
  title: string | null;
  artist: string | null;
  version: string | null;
  mapper: string | null;
  mode: string | null;
  modeNumber: number | null;
  /** Mania key count when available (CS). */
  keys: number | null;
  starRating: number | null;
  /** Lazer-style mods JSON string for ModBadges. */
  mods: string | null;
  state: string | null;
  stateNumber: number | null;
};

export type TosuLivePlay = {
  active: boolean;
  accuracy: number | null;
  combo: number | null;
  maxCombo: number | null;
  misses: number | null;
  score: number | null;
  pp: number | null;
};

export type TosuLiveSunny = {
  sunnyStar: number | null;
  estDiff: string | null;
  lnRatio: number | null;
  columnCount: number | null;
  error: string | null;
  source: "db" | "osu-text";
};

export type TosuLivePattern = {
  dominantPattern: string | null;
  secondaryPattern: string | null;
  confidence: number | null;
  columnCount: number | null;
  error: string | null;
  source: "db" | "osu-text";
};

export type TosuLiveAnalysis = {
  sunny: TosuLiveSunny | null;
  pattern: TosuLivePattern | null;
  analyzing: boolean;
};

export type TosuLiveSnapshot = {
  connected: boolean;
  status: TosuConnectionStatus;
  host: string;
  enabled: boolean;
  warnings: string[];
  beatmap: TosuLiveBeatmap | null;
  play: TosuLivePlay | null;
  analysis: TosuLiveAnalysis;
  matchedBeatmapId: string | null;
  updatedAt: string;
};
