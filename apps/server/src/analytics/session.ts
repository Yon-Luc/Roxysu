
import type { Db } from "@roxysu/db/types";
import { beatmapDanRatings, beatmapSets, beatmaps, scoreMetrics, scores, sessions } from "@roxysu/db/schema";
import {
  capitalizeSessionName,
  generateSessionName,
} from "@roxysu/session-names";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { publish } from "../shared/events";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import {
  danielEstDiffSelect,
  danielStarSelect,
} from "../map-analysis/danRatingSelect";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "./scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "./scoreUsername";

const SESSION_GAP_MS = 30 * 60 * 1000;

function collectTakenNames(rows: { name: string | null }[]): Set<string> {
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.name) taken.add(capitalizeSessionName(row.name));
  }
  return taken;
}

async function sessionNamesNeedBackfill(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      or(
        isNull(sessions.name),
        eq(sessions.name, ""),
        sql`substr(${sessions.name}, 1, 1) != upper(substr(${sessions.name}, 1, 1))`,
      ),
    )
    .limit(1);
  return row != null;
}

async function backfillSessionNames(db: Db): Promise<void> {
  if (!(await sessionNamesNeedBackfill(db))) return;
  const rows = await db
    .select({ id: sessions.id, name: sessions.name })
    .from(sessions);
  const taken = collectTakenNames(rows);

  for (const row of rows) {
    if (row.name != null) {
      const next = capitalizeSessionName(row.name);
      if (row.name !== next) {
        await db
          .update(sessions)
          .set({ name: next })
          .where(eq(sessions.id, row.id));
      }
      continue;
    }
    const next = generateSessionName(row.id, taken);
    taken.add(next);
    await db
      .update(sessions)
      .set({ name: next })
      .where(eq(sessions.id, row.id));
  }
}

function sessionDisplayName(session: { id: number; name: string | null }): string {
  return capitalizeSessionName(session.name ?? generateSessionName(session.id));
}

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

const METRICS_PATCH_CHUNK = 200;

function applySessionIdPatches(
  db: Db,
  patches: Array<{ scoreId: string; sessionId: number }>,
): void {
  for (let i = 0; i < patches.length; i += METRICS_PATCH_CHUNK) {
    const chunk = patches.slice(i, i + METRICS_PATCH_CHUNK);
    if (chunk.length === 0) continue;
    const cases = chunk.map(() => "WHEN ? THEN ?").join(" ");
    const ids = chunk.map(() => "?").join(", ");
    const params: Array<string | number> = [];
    for (const p of chunk) {
      params.push(p.scoreId, p.sessionId);
    }
    for (const p of chunk) {
      params.push(p.scoreId);
    }
    db.$client
      .query(
        `UPDATE score_metrics SET session_id = CASE score_id ${cases} END WHERE score_id IN (${ids})`,
      )
      .run(...params);
  }
}

function sessionRowChanged(
  prev:
    | {
        startedAt: Date | number;
        endedAt: Date | number | null;
        scoreCount: number;
        rulesetShortName: string | null;
      }
    | undefined,
  bucket: {
    startedAt: Date;
    endedAt: Date;
    scoreIds: string[];
    rulesetShortName: string | null;
  },
  isOpen: boolean,
  namePatch: { name?: string },
): boolean {
  if (!prev) return true;
  if (namePatch.name != null) return true;
  if (toMs(prev.startedAt) !== bucket.startedAt.getTime()) return true;
  const nextEnded = isOpen ? null : bucket.endedAt.getTime();
  const prevEnded = prev.endedAt == null ? null : toMs(prev.endedAt);
  if (prevEnded !== nextEnded) return true;
  if (prev.scoreCount !== bucket.scoreIds.length) return true;
  return (prev.rulesetShortName ?? null) !== (bucket.rulesetShortName ?? null);
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
  await backfillSessionNames(db);

  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const rows = await db
    .select({
      id: scores.id,
      playedAt: scores.playedAt,
      rulesetShortName: scores.rulesetShortName,
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

  const started: number[] = [];
  const finished: number[] = [];

  const existingSessions = await db.select().from(sessions);
  const existingById = new Map(existingSessions.map((s) => [s.id, s]));
  const takenNames = collectTakenNames(existingSessions);

  const assignName = (sessionId: number): string => {
    const name = generateSessionName(sessionId, takenNames);
    takenNames.add(name);
    return name;
  };

  const allMetrics = await db.select().from(scoreMetrics);
  const metricsByScore = new Map(allMetrics.map((m) => [m.scoreId, m]));
  const sessionByScore = new Map(
    allMetrics.map((m) => [m.scoreId, m.sessionId] as const),
  );

  if (rows.length === 0) {
    db.transaction((tx) => {
      for (const m of allMetrics) {
        if (m.sessionId != null) {
          tx.update(scoreMetrics)
            .set({ sessionId: null })
            .where(eq(scoreMetrics.scoreId, m.scoreId))
            .run();
        }
      }
      if (existingSessions.length > 0) {
        tx.delete(sessions).run();
      }
    });
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

  db.transaction((tx) => {
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
        const namePatch =
          prevRow?.name == null ? { name: assignName(sessionId) } : {};
        if (sessionRowChanged(prevRow, bucket, isOpen, namePatch)) {
          tx.update(sessions)
            .set({
              startedAt: bucket.startedAt,
              endedAt: isOpen ? null : bucket.endedAt,
              scoreCount: bucket.scoreIds.length,
              rulesetShortName: bucket.rulesetShortName,
              ...namePatch,
            })
            .where(eq(sessions.id, sessionId))
            .run();
        }

        if (isOpen && !wasOpen) started.push(sessionId);
        if (!isOpen && wasOpen) finished.push(sessionId);
      } else {
        const inserted = tx
          .insert(sessions)
          .values({
            startedAt: bucket.startedAt,
            endedAt: isOpen ? null : bucket.endedAt,
            scoreCount: bucket.scoreIds.length,
            rulesetShortName: bucket.rulesetShortName,
          })
          .returning({ id: sessions.id })
          .get();

        sessionId = inserted.id;
        claimedSessionIds.add(sessionId);
        tx.update(sessions)
          .set({ name: assignName(sessionId) })
          .where(eq(sessions.id, sessionId))
          .run();
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
      tx.delete(sessions).where(inArray(sessions.id, orphanIds)).run();
    }

    const metricPatches: Array<{ scoreId: string; sessionId: number }> = [];
    const metricInserts: Array<{
      scoreId: string;
      retryIndex: number;
      isPb: boolean;
      sessionId: number;
    }> = [];
    for (const [scoreId, sessionId] of scoreToSession) {
      const existing = metricsByScore.get(scoreId);
      if (existing) {
        if (existing.sessionId !== sessionId) {
          metricPatches.push({ scoreId, sessionId });
        }
      } else {
        metricInserts.push({
          scoreId,
          retryIndex: 0,
          isPb: false,
          sessionId,
        });
      }
    }
    applySessionIdPatches(db, metricPatches);
    if (metricInserts.length > 0) {
      tx.insert(scoreMetrics).values(metricInserts).run();
    }
  });

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
  if (!current) return null;
  return {
    ...current,
    name: sessionDisplayName(current),
  };
}

export async function getSessionById(db: Db, id: number) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    name: sessionDisplayName(row),
  };
}

export async function listSessionScores(
  db: Db,
  sessionId: number,
  opts?: { limit?: number },
) {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const q = db
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
      replayFileHash: scores.replayFileHash,
      playedAt: scores.playedAt,
      isPb: scoreMetrics.isPb,
      retryIndex: scoreMetrics.retryIndex,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      starRating: beatmaps.starRating,
      keyCount: beatmaps.circleSize,
      setOnlineId: beatmapSets.onlineId,
      backgroundFileHash: beatmaps.backgroundFileHash,
      sunnyEstDiff: beatmapDanRatings.estDiff,
      sunnyStar: beatmapDanRatings.sunnyStar,
      danielEstDiff: danielEstDiffSelect(),
      danielStar: danielStarSelect(),
    })
    .from(scoreMetrics)
    .innerJoin(scores, eq(scoreMetrics.scoreId, scores.id))
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .leftJoin(
      beatmapDanRatings,
      and(
        eq(beatmapDanRatings.beatmapId, beatmaps.id),
        eq(beatmapDanRatings.algorithm, SUNNY_ALGORITHM),
      ),
    )
    .where(
      and(
        eq(scoreMetrics.sessionId, sessionId),
        eq(scores.deletePending, false),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    )
    .orderBy(desc(scores.playedAt), desc(scores.id));
  return opts?.limit != null ? q.limit(opts.limit) : q;
}

export async function countSessionPbs(db: Db, sessionId: number): Promise<number> {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const [row] = await db
    .select({ n: count() })
    .from(scoreMetrics)
    .innerJoin(scores, eq(scoreMetrics.scoreId, scores.id))
    .where(
      and(
        eq(scoreMetrics.sessionId, sessionId),
        eq(scoreMetrics.isPb, true),
        eq(scores.deletePending, false),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function listSessions(db: Db, limit = 50) {
  const rows = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    name: sessionDisplayName(row),
  }));
}

export async function listSessionsForBeatmap(
  db: Db,
  beatmapId: string,
  limit = 24,
) {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const rows = await db
    .select({
      sessionId: scoreMetrics.sessionId,
    })
    .from(scores)
    .innerJoin(scoreMetrics, eq(scores.id, scoreMetrics.scoreId))
    .where(
      and(
        eq(scores.beatmapId, beatmapId),
        eq(scores.deletePending, false),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    )
    .orderBy(desc(scores.playedAt))
    .limit(Math.max(limit * 10, 80));

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
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        name: sessionDisplayName(row),
      })),
    );
}
