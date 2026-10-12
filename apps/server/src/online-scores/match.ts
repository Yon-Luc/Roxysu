export type RankedBest = {
  id: number;
  legacyScoreId: number | null;
  beatmapId: number;
  beatmapsetId?: number | null;
  checksum: string | null;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  totalScore: number;
  totalScoreWithoutMods: number;
  legacyTotalScore: number | null;
  rank: string;
  modsJson: string;
  statistics: Record<string, number>;
  maximumStatistics: Record<string, number> | null;
  endedAt: string;
  userId: number;
  username: string;
  isLegacy: boolean;
};

export type LocalScoreKey = {
  onlineId: number;
  legacyOnlineId: number;
  beatmapOnlineId: number | null;
  playedAtMs: number;
  totalScore: number;
  legacyTotalScore: number | null;
};

export type LocalBeatmap = {
  id: string;
  onlineId: number;
  md5Hash: string | null;
  hash: string | null;
  totalObjectCount: number;
  rulesetShortName: string | null;
};

export type ScorePullClass =
  | "already"
  | "add"
  | "add-current-version"
  | "skipped";

const FINGERPRINT_MS = 5_000;

export function endedAtMs(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function sameMd5(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function classifyRankedBest(
  score: RankedBest,
  local: {
    onlineIds: Set<number>;
    legacyIds: Set<number>;
    fingerprints: LocalScoreKey[];
    beatmapsByOnlineId: Map<number, LocalBeatmap[]>;
  },
): { kind: ScorePullClass; beatmap: LocalBeatmap | null } {
  if (score.id > 0 && local.onlineIds.has(score.id)) {
    return { kind: "already", beatmap: null };
  }
  if (score.legacyScoreId != null && score.legacyScoreId > 0 && local.legacyIds.has(score.legacyScoreId)) {
    return { kind: "already", beatmap: null };
  }

  const played = endedAtMs(score.endedAt);
  for (const row of local.fingerprints) {
    if (row.beatmapOnlineId !== score.beatmapId) continue;
    if (Math.abs(row.playedAtMs - played) > FINGERPRINT_MS) continue;
    const totals = [row.totalScore, row.legacyTotalScore ?? -1];
    if (
      totals.includes(score.totalScore) ||
      (score.legacyTotalScore != null && totals.includes(score.legacyTotalScore))
    ) {
      return { kind: "already", beatmap: null };
    }
  }

  const maps = local.beatmapsByOnlineId.get(score.beatmapId) ?? [];
  if (maps.length === 0) return { kind: "skipped", beatmap: null };

  const md5Hit = score.checksum
    ? maps.find((map) => sameMd5(map.md5Hash, score.checksum))
    : undefined;
  if (md5Hit) return { kind: "add", beatmap: md5Hit };

  const withHash = maps.find((map) => map.hash && map.hash.length > 0) ?? maps[0]!;
  return { kind: "add-current-version", beatmap: withHash };
}
