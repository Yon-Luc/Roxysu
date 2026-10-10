import type { Db } from "@roxysu/db/types";
import { scores } from "@roxysu/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";

export type PbCompareKind = "previous" | "current";

export type PbCompareScore = {
  id: string;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
  rank: number;
  playedAt: Date;
};

export type PbCompareResult = PbCompareScore & {
  kind: PbCompareKind;
};

type RankableScore = {
  id: string;
  beatmapId: string;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
  rank: number;
  playedAt: Date;
};

/** Same ranking as `runRetryEngine`: higher pp, then accuracy; earlier play wins ties. */
export function comparePbRank(a: RankableScore, b: RankableScore): number {
  const ppA = a.pp ?? Number.NEGATIVE_INFINITY;
  const ppB = b.pp ?? Number.NEGATIVE_INFINITY;
  if (ppA !== ppB) return ppB - ppA;
  if (a.accuracy !== b.accuracy) return b.accuracy - a.accuracy;
  const tA = a.playedAt.getTime();
  const tB = b.playedAt.getTime();
  if (tA !== tB) return tA - tB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Top two scores per beatmap after PB ranking. */
export function topTwoByBeatmap(
  rows: RankableScore[],
): Map<string, [RankableScore, RankableScore | null]> {
  const grouped = new Map<string, RankableScore[]>();
  for (const row of rows) {
    const list = grouped.get(row.beatmapId);
    if (list) list.push(row);
    else grouped.set(row.beatmapId, [row]);
  }
  const out = new Map<string, [RankableScore, RankableScore | null]>();
  for (const [beatmapId, list] of grouped) {
    list.sort(comparePbRank);
    out.set(beatmapId, [list[0]!, list[1] ?? null]);
  }
  return out;
}

export function pickPbCompare(opts: {
  isPb: boolean;
  scoreId: string;
  top: [RankableScore, RankableScore | null] | undefined;
}): PbCompareResult | null {
  const { isPb, scoreId, top } = opts;
  if (!top) return null;
  const [first, second] = top;
  if (isPb) {
    if (!second || second.id === scoreId) return null;
    return { kind: "previous", ...toCompareScore(second) };
  }
  if (first.id === scoreId) return null;
  return { kind: "current", ...toCompareScore(first) };
}

function toCompareScore(row: RankableScore): PbCompareScore {
  return {
    id: row.id,
    accuracy: row.accuracy,
    pp: row.pp,
    maxCombo: row.maxCombo,
    mods: row.mods,
    rank: row.rank,
    playedAt: row.playedAt,
  };
}

/** Load top-2 PB-ranked scores for each beatmap (username/gamemode scoped). */
export async function loadPbCompareForBeatmaps(
  db: Db,
  beatmapIds: string[],
): Promise<Map<string, [RankableScore, RankableScore | null]>> {
  const unique = [...new Set(beatmapIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);

  const rows = await db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      maxCombo: scores.maxCombo,
      mods: scores.mods,
      rank: scores.rank,
      playedAt: scores.playedAt,
    })
    .from(scores)
    .where(
      and(
        inArray(scores.beatmapId, unique),
        eq(scores.deletePending, false),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    )
    .orderBy(asc(scores.playedAt), asc(scores.id));

  const rankable: RankableScore[] = [];
  for (const row of rows) {
    if (!row.beatmapId) continue;
    rankable.push({
      id: row.id,
      beatmapId: row.beatmapId,
      accuracy: row.accuracy,
      pp: row.pp,
      maxCombo: row.maxCombo,
      mods: row.mods,
      rank: row.rank,
      playedAt: row.playedAt,
    });
  }
  return topTwoByBeatmap(rankable);
}
