import type { Db } from "@roxysu/db/types";
import { scoreMetrics, scores } from "@roxysu/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "./scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "./scoreUsername";

/**
 * Assign retry_index (consecutive same-beatmap plays in global timeline)
 * and is_pb flags. Rebuilds score_metrics while preserving sessionId.
 */
export async function runRetryEngine(db: Db): Promise<void> {
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
  const existing = await db
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
    retryIndex: number;
    isPb: boolean;
    sessionId: number | null;
  }> = [];

  let prevBeatmapId: string | null = null;
  let retryIndex = 0;

  // Per-beatmap PB tracking
  const bestByBeatmap = new Map<
    string,
    { scoreId: string; pp: number; accuracy: number }
  >();

  for (const row of rows) {
    if (row.beatmapId && row.beatmapId === prevBeatmapId) {
      retryIndex += 1;
    } else {
      retryIndex = 0;
      prevBeatmapId = row.beatmapId;
    }

    if (row.beatmapId) {
      const cur = bestByBeatmap.get(row.beatmapId);
      const pp = row.pp ?? -Infinity;
      const better =
        !cur ||
        pp > cur.pp ||
        (pp === cur.pp && row.accuracy > cur.accuracy) ||
        (cur.pp === -Infinity && row.accuracy > cur.accuracy);
      if (better) {
        bestByBeatmap.set(row.beatmapId, {
          scoreId: row.id,
          pp: row.pp ?? -Infinity,
          accuracy: row.accuracy,
        });
      }
    }

    metrics.push({
      scoreId: row.id,
      retryIndex,
      isPb: false,
      sessionId: sessionByScore.get(row.id) ?? null,
    });
  }

  const pbIds = new Set(
    [...bestByBeatmap.values()].map((b) => b.scoreId),
  );
  for (const m of metrics) {
    if (pbIds.has(m.scoreId)) m.isPb = true;
  }

  await db.delete(scoreMetrics);
  const BATCH = 500;
  for (let i = 0; i < metrics.length; i += BATCH) {
    const batch = metrics.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    await db.insert(scoreMetrics).values(batch);
  }
}
