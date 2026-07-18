import {
  and,
  asc,
  eq,
  isNull,
  desc,
  inArray,
  type Db,
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
 * Rebuilds sessions and updates score_metrics.session_id.
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

  // Preserve nothing — full rebuild
  await db.delete(sessions);

  if (rows.length === 0) {
    const existing = await db.select().from(scoreMetrics);
    for (const m of existing) {
      if (m.sessionId != null) {
        await db
          .update(scoreMetrics)
          .set({ sessionId: null })
          .where(eq(scoreMetrics.scoreId, m.scoreId));
      }
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

  for (const bucket of buckets) {
    const isOpen = now - bucket.endedAt.getTime() <= SESSION_GAP_MS;
    const inserted = await db
      .insert(sessions)
      .values({
        startedAt: bucket.startedAt,
        endedAt: isOpen ? null : bucket.endedAt,
        scoreCount: bucket.scoreIds.length,
        rulesetShortName: bucket.rulesetShortName,
      })
      .returning({ id: sessions.id });

    const sessionId = inserted[0]!.id;
    if (isOpen) started.push(sessionId);
    else finished.push(sessionId);

    for (const scoreId of bucket.scoreIds) {
      scoreToSession.set(scoreId, sessionId);
    }
  }

  const allMetrics = await db.select().from(scoreMetrics);
  const metricsByScore = new Map(allMetrics.map((m) => [m.scoreId, m]));

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
  // Only emit finished for sessions that just closed relative to "now" —
  // skip flooding SSE with historical session rebuilds.
  void finished;

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
