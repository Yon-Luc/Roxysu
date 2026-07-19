import {
  and,
  asc,
  eq,
  isNull,
  desc,
  inArray,
  type Db,
  beatmaps,
  beatmapSets,
  scores,
  scoreMetrics,
  sessions,
} from "@roxysu/db/client.bun";
import { publish } from "../shared/events";

const SESSION_GAP_MS = 30 * 60 * 1000;

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

export type SessionEngineResult = {
  started: number[];
  finished: number[];
};

/**
 * Group scores into sessions by 30-minute inactivity gaps.
 * Reuses existing session IDs when buckets still map to the same scores,
 * so IDs stay stable across sync/analytics rebuilds.
 */
export async function runSessionEngine(db: Db): Promise<SessionEngineResult> {
  const rows = await db
    .select({
      id: scores.id,
      playedAt: scores.playedAt,
      rulesetShortName: scores.rulesetShortName,
    })
    .from(scores)
    .where(eq(scores.deletePending, false))
    .orderBy(asc(scores.playedAt), asc(scores.id));

  const started: number[] = [];
  const finished: number[] = [];

  const existingSessions = await db.select().from(sessions);
  const existingById = new Map(existingSessions.map((s) => [s.id, s]));

  const allMetrics = await db.select().from(scoreMetrics);
  const metricsByScore = new Map(allMetrics.map((m) => [m.scoreId, m]));
  const sessionByScore = new Map(
    allMetrics.map((m) => [m.scoreId, m.sessionId] as const),
  );

  if (rows.length === 0) {
    for (const m of allMetrics) {
      if (m.sessionId != null) {
        await db
          .update(scoreMetrics)
          .set({ sessionId: null })
          .where(eq(scoreMetrics.scoreId, m.scoreId));
      }
    }
    if (existingSessions.length > 0) {
      await db.delete(sessions);
    }
    return { started, finished };
  }

  type Bucket = {
    startedAt: Date;
    endedAt: Date;
    scoreIds: string[];
    rulesetShortName: string | null;
  };

  const buckets: Bucket[] = [];
  let current: Bucket | null = null;

  for (const row of rows) {
    const played = new Date(toMs(row.playedAt));
    if (
      !current ||
      played.getTime() - current.endedAt.getTime() > SESSION_GAP_MS
    ) {
      if (current) buckets.push(current);
      current = {
        startedAt: played,
        endedAt: played,
        scoreIds: [row.id],
        rulesetShortName: row.rulesetShortName,
      };
    } else {
      current.endedAt = played;
      current.scoreIds.push(row.id);
      if (!current.rulesetShortName && row.rulesetShortName) {
        current.rulesetShortName = row.rulesetShortName;
      }
    }
  }
  if (current) buckets.push(current);

  const now = Date.now();
  const scoreToSession = new Map<string, number>();
  const claimedSessionIds = new Set<number>();

  for (const bucket of buckets) {
    const isOpen = now - bucket.endedAt.getTime() <= SESSION_GAP_MS;

    // Prefer the earliest score's prior session, then any unclaimed match.
    let sessionId: number | null = null;
    for (const scoreId of bucket.scoreIds) {
      const prev = sessionByScore.get(scoreId);
      if (
        prev != null &&
        existingById.has(prev) &&
        !claimedSessionIds.has(prev)
      ) {
        sessionId = prev;
        break;
      }
    }

    const prevRow = sessionId != null ? existingById.get(sessionId) : undefined;
    const wasOpen = prevRow != null && prevRow.endedAt == null;

    if (sessionId != null) {
      claimedSessionIds.add(sessionId);
      await db
        .update(sessions)
        .set({
          startedAt: bucket.startedAt,
          endedAt: isOpen ? null : bucket.endedAt,
          scoreCount: bucket.scoreIds.length,
          rulesetShortName: bucket.rulesetShortName,
        })
        .where(eq(sessions.id, sessionId));

      if (isOpen && !wasOpen) started.push(sessionId);
      if (!isOpen && wasOpen) finished.push(sessionId);
    } else {
      const inserted = await db
        .insert(sessions)
        .values({
          startedAt: bucket.startedAt,
          endedAt: isOpen ? null : bucket.endedAt,
          scoreCount: bucket.scoreIds.length,
          rulesetShortName: bucket.rulesetShortName,
        })
        .returning({ id: sessions.id });

      sessionId = inserted[0]!.id;
      claimedSessionIds.add(sessionId);
      if (isOpen) started.push(sessionId);
    }

    for (const scoreId of bucket.scoreIds) {
      scoreToSession.set(scoreId, sessionId);
    }
  }

  const orphanIds = existingSessions
    .map((s) => s.id)
    .filter((id) => !claimedSessionIds.has(id));
  if (orphanIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.id, orphanIds));
  }

  for (const [scoreId, sessionId] of scoreToSession) {
    const existing = metricsByScore.get(scoreId);
    if (existing) {
      if (existing.sessionId !== sessionId) {
        await db
          .update(scoreMetrics)
          .set({ sessionId })
          .where(eq(scoreMetrics.scoreId, scoreId));
      }
    } else {
      await db.insert(scoreMetrics).values({
        scoreId,
        retryIndex: 0,
        isPb: false,
        sessionId,
      });
    }
  }

  for (const id of started) {
    publish({ type: "session.started", sessionId: id });
  }
  for (const id of finished) {
    publish({ type: "session.finished", sessionId: id });
  }

  return { started, finished };
}

export async function getCurrentSession(db: Db) {
  const [current] = await db
    .select()
    .from(sessions)
    .where(isNull(sessions.endedAt))
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return current ?? null;
}

export async function getSessionById(db: Db, id: number) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return row ?? null;
}

export async function listSessionScores(db: Db, sessionId: number) {
  return db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      maxCombo: scores.maxCombo,
      mods: scores.mods,
      rank: scores.rank,
      totalScore: scores.totalScore,
      rulesetShortName: scores.rulesetShortName,
      playedAt: scores.playedAt,
      isPb: scoreMetrics.isPb,
      retryIndex: scoreMetrics.retryIndex,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      starRating: beatmaps.starRating,
      setOnlineId: beatmapSets.onlineId,
      backgroundFileHash: beatmaps.backgroundFileHash,
    })
    .from(scoreMetrics)
    .innerJoin(scores, eq(scoreMetrics.scoreId, scores.id))
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(
      and(
        eq(scoreMetrics.sessionId, sessionId),
        eq(scores.deletePending, false),
      ),
    )
    .orderBy(desc(scores.playedAt), desc(scores.id));
}

export async function listSessions(db: Db, limit = 50) {
  return db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
}

export async function listSessionsForBeatmap(db: Db, beatmapId: string) {
  const rows = await db
    .select({
      sessionId: scoreMetrics.sessionId,
    })
    .from(scores)
    .innerJoin(scoreMetrics, eq(scores.id, scoreMetrics.scoreId))
    .where(
      and(eq(scores.beatmapId, beatmapId), eq(scores.deletePending, false)),
    );

  const ids = [
    ...new Set(
      rows
        .map((r) => r.sessionId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (ids.length === 0) return [];

  return db
    .select()
    .from(sessions)
    .where(inArray(sessions.id, ids))
    .orderBy(desc(sessions.startedAt));
}
