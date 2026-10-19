import type { Db } from "@roxysu/db/types";
import { scoreMetrics, scores } from "@roxysu/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "./scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "./scoreUsername";
import {
  loadManiaPpCurves,
  resolveScorePp,
  type ManiaPpCurve,
} from "../mania-rating/estimateScorePp";
import { comparePbRank, type PbRankKey } from "../scores/pbCompare";

export type RetryEngineOptions = {
  /**
   * When set, only rewrite score_metrics for scores on these beatmaps.
   * Full timeline is still read so retry_index stays globally correct.
   */
  beatmapIds?: string[];
};

const CURVE_CHUNK = 500;

async function loadCurves(
  db: Db,
  beatmapIds: string[] | undefined,
): Promise<Map<string, ManiaPpCurve>> {
  if (!beatmapIds) return loadManiaPpCurves(db);
  const out = new Map<string, ManiaPpCurve>();
  for (let i = 0; i < beatmapIds.length; i += CURVE_CHUNK) {
    const chunk = await loadManiaPpCurves(
      db,
      beatmapIds.slice(i, i + CURVE_CHUNK),
    );
    for (const [id, curve] of chunk) out.set(id, curve);
  }
  return out;
}

/**
 * Assign retry_index (consecutive same-beatmap plays in global timeline)
 * and is_pb flags. Preserves sessionId on existing metrics rows.
 */
export async function runRetryEngine(
  db: Db,
  options?: RetryEngineOptions,
): Promise<void> {
  const scopeIds = options?.beatmapIds?.filter(Boolean);
  const scoped = scopeIds != null && scopeIds.length > 0;
  const scopeSet = scoped ? new Set(scopeIds) : null;

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
      mods: scores.mods,
      rulesetShortName: scores.rulesetShortName,
      playedAt: scores.playedAt,
    })
    .from(scores)
    .where(
      and(
        eq(scores.deletePending, false),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    )
    .orderBy(asc(scores.playedAt), asc(scores.id));

  const existing = scoped
    ? await db
        .select({
          scoreId: scoreMetrics.scoreId,
          sessionId: scoreMetrics.sessionId,
        })
        .from(scoreMetrics)
        .innerJoin(scores, eq(scores.id, scoreMetrics.scoreId))
        .where(inArray(scores.beatmapId, scopeIds!))
    : await db
        .select({
          scoreId: scoreMetrics.scoreId,
          sessionId: scoreMetrics.sessionId,
        })
        .from(scoreMetrics);

  const sessionByScore = new Map(
    existing.map((e) => [e.scoreId, e.sessionId] as const),
  );

  const metrics: Array<{
    scoreId: string;
    beatmapId: string | null;
    retryIndex: number;
    isPb: boolean;
    sessionId: number | null;
  }> = [];

  let prevBeatmapId: string | null = null;
  let retryIndex = 0;

  // PB ranking uses resolved PP (stored, else NM/MR mania curve estimate), the
  // value mastery best_pp ranks by. Scoped runs only need the scoped curves.
  const curves = await loadCurves(db, scoped ? scopeIds : undefined);
  const bestByBeatmap = new Map<string, PbRankKey>();

  for (const row of rows) {
    if (row.beatmapId && row.beatmapId === prevBeatmapId) {
      retryIndex += 1;
    } else {
      retryIndex = 0;
      prevBeatmapId = row.beatmapId;
    }

    if (row.beatmapId) {
      const candidate: PbRankKey = {
        id: row.id,
        accuracy: row.accuracy,
        pp: resolveScorePp({
          pp: row.pp,
          accuracy: row.accuracy,
          mods: row.mods,
          rulesetShortName: row.rulesetShortName,
          curve: curves.get(row.beatmapId),
        }),
        playedAt: row.playedAt,
      };
      const cur = bestByBeatmap.get(row.beatmapId);
      if (!cur || comparePbRank(candidate, cur) < 0) {
        bestByBeatmap.set(row.beatmapId, candidate);
      }
    }

    metrics.push({
      scoreId: row.id,
      beatmapId: row.beatmapId,
      retryIndex,
      isPb: false,
      sessionId: sessionByScore.get(row.id) ?? null,
    });
  }

  const pbIds = new Set(
    [...bestByBeatmap.values()].map((b) => b.id),
  );
  for (const m of metrics) {
    if (pbIds.has(m.scoreId)) m.isPb = true;
  }

  const toWrite = scopeSet
    ? metrics.filter((m) => m.beatmapId != null && scopeSet.has(m.beatmapId))
    : metrics;

  if (!scoped) {
    await db.delete(scoreMetrics);
  } else if (toWrite.length > 0) {
    const scoreIds = toWrite.map((m) => m.scoreId);
    const BATCH_DEL = 500;
    for (let i = 0; i < scoreIds.length; i += BATCH_DEL) {
      const chunk = scoreIds.slice(i, i + BATCH_DEL);
      await db.delete(scoreMetrics).where(inArray(scoreMetrics.scoreId, chunk));
    }
  }

  const BATCH = 500;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = toWrite.slice(i, i + BATCH).map(({ scoreId, retryIndex: ri, isPb, sessionId }) => ({
      scoreId,
      retryIndex: ri,
      isPb,
      sessionId,
    }));
    if (batch.length === 0) continue;
    await db.insert(scoreMetrics).values(batch);
  }
}
