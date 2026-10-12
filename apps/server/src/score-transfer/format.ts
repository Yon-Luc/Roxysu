export const SCORE_TRANSFER_FORMAT = "roxysu-scores";
export const SCORE_TRANSFER_VERSION = 1;

export type ScoreTransferRow = {
  onlineId: number;
  legacyOnlineId: number;
  beatmapOnlineId: number;
  beatmapMd5: string | null;
  beatmapHash: string | null;
  ruleset: string;
  clientVersion: string | null;
  totalScore: number;
  totalScoreWithoutMods: number;
  legacyTotalScore: number | null;
  maxCombo: number;
  combo: number;
  accuracy: number;
  pp: number | null;
  rank: number;
  mods: string | null;
  statistics: string | null;
  maximumStatistics: string | null;
  playedAt: number;
  userOnlineId: number | null;
  username: string | null;
  isLegacy: boolean;
};

export type ScoreTransferFile = {
  format: typeof SCORE_TRANSFER_FORMAT;
  version: typeof SCORE_TRANSFER_VERSION;
  exportedAt: string;
  scores: ScoreTransferRow[];
};

export type ParsedScoreTransfer = {
  file: ScoreTransferFile;
  invalid: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, fallback: number | null = null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function jsonText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
  return null;
}

export function parseScoreTransferRow(value: unknown): ScoreTransferRow | null {
  if (!isRecord(value)) return null;
  const ruleset = text(value.ruleset);
  const playedAt = finite(value.playedAt);
  const totalScore = finite(value.totalScore);
  if (!ruleset || playedAt == null || totalScore == null) return null;
  return {
    onlineId: finite(value.onlineId, 0) ?? 0,
    legacyOnlineId: finite(value.legacyOnlineId, 0) ?? 0,
    beatmapOnlineId: finite(value.beatmapOnlineId, 0) ?? 0,
    beatmapMd5: text(value.beatmapMd5),
    beatmapHash: text(value.beatmapHash),
    ruleset,
    clientVersion: text(value.clientVersion),
    totalScore,
    totalScoreWithoutMods: finite(value.totalScoreWithoutMods, totalScore) ?? totalScore,
    legacyTotalScore: finite(value.legacyTotalScore),
    maxCombo: finite(value.maxCombo, 0) ?? 0,
    combo: finite(value.combo, finite(value.maxCombo, 0) ?? 0) ?? 0,
    accuracy: finite(value.accuracy, 0) ?? 0,
    pp: finite(value.pp),
    rank: finite(value.rank, 0) ?? 0,
    mods: jsonText(value.mods),
    statistics: jsonText(value.statistics),
    maximumStatistics: jsonText(value.maximumStatistics),
    playedAt,
    userOnlineId: finite(value.userOnlineId),
    username: text(value.username),
    isLegacy: value.isLegacy === true,
  };
}

export function parseScoreTransferFile(raw: unknown): ParsedScoreTransfer | { error: string } {
  if (!isRecord(raw)) return { error: "This file is not a Roxysu score transfer." };
  if (raw.format !== SCORE_TRANSFER_FORMAT || raw.version !== SCORE_TRANSFER_VERSION) {
    return { error: "This file is not a Roxysu score transfer." };
  }
  if (!Array.isArray(raw.scores)) return { error: "This file is not a Roxysu score transfer." };
  const scores: ScoreTransferRow[] = [];
  let invalid = 0;
  for (const row of raw.scores) {
    const parsed = parseScoreTransferRow(row);
    if (!parsed) {
      invalid += 1;
      continue;
    }
    scores.push(parsed);
  }
  return {
    file: {
      format: SCORE_TRANSFER_FORMAT,
      version: SCORE_TRANSFER_VERSION,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      scores,
    },
    invalid,
  };
}
