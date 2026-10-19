
import type { Db } from "@roxysu/db/types";
import { beatmapDanRatings, beatmapSets, beatmaps, scoreMetrics, scores, sessions } from "@roxysu/db/schema";
import {
  capitalizeSessionName,
  generateSessionName,
} from "@roxysu/session-names";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { publish } from "../shared/events";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import {
  danielEstDiffSelect,
  danielStarSelect,
  reworkEstDiffSelect,
  reworkLnRatioSelect,
  reworkStarSelect,
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

export type SessionEngineOptions = {
  /**
   * When set, repair only the sessions these scores touch (see
   * `tryRepairSessionDelta`). Falls back to a full rebuild when the stored
   * sessions are not consistent with the scoped scores.
   */
  scoreIds?: string[];
};

type SessionRow = typeof sessions.$inferSelect;

type ScopedScoreRow = {
  id: string;
  playedAt: Date | number;
  rulesetShortName: string | null;
};

type Bucket = {
  startedAt: Date;
  endedAt: Date;
  scoreIds: string[];
  rulesetShortName: string | null;
};

/** Keep bound-parameter counts well under SQLite's variable limit. */
const ID_CHUNK = 500;

function chunked<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function compareScoreRows(a: ScopedScoreRow, b: ScopedScoreRow): number {
  const delta = toMs(a.playedAt) - toMs(b.playedAt);
  if (delta !== 0) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Group time-ordered scores into buckets split by gaps larger than `SESSION_GAP_MS`. */
function bucketScoreRows(rows: ScopedScoreRow[]): Bucket[] {
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
  return buckets;
}

/** Username + gamemode + not-deleted scope shared by every engine read. */
async function scopedScoresWhere(db: Db) {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  return and(
    eq(scores.deletePending, false),
    scoresUsernameCondition(usernames),
    scoresGamemodeCondition(gamemode),
  );
}

/**
 * For each bucket, the distinct session ids its scores were previously
 * attached to, in score order. Reads `score_metrics` in id chunks so memory
 * stays bounded instead of selecting every metrics row.
 */
async function loadPriorSessionsByBucket(
  db: Db,
  buckets: Bucket[],
): Promise<number[][]> {
  const priors: number[][] = buckets.map(() => []);
  const flat: Array<{ bucket: number; scoreId: string }> = [];
  buckets.forEach((bucket, bucketIndex) => {
    for (const scoreId of bucket.scoreIds) {
      flat.push({ bucket: bucketIndex, scoreId });
    }
  });

  for (const chunk of chunked(flat)) {
    const rows = await db
      .select({
        scoreId: scoreMetrics.scoreId,
        sessionId: scoreMetrics.sessionId,
      })
      .from(scoreMetrics)
      .where(
        inArray(
          scoreMetrics.scoreId,
          chunk.map((c) => c.scoreId),
        ),
      );
    const byScore = new Map(rows.map((r) => [r.scoreId, r.sessionId] as const));
    for (const { bucket, scoreId } of chunk) {
      const prev = byScore.get(scoreId);
      if (prev != null && !priors[bucket]!.includes(prev)) {
        priors[bucket]!.push(prev);
      }
    }
  }
  return priors;
}

/**
 * Write `buckets` as sessions and point their scores at them.
 *
 * `candidates` are the stored sessions the buckets may reuse; candidates that
 * no bucket claims are deleted. Every write runs in one synchronous
 * transaction callback (required by better-sqlite3 on desktop). Metrics are
 * written with SQL (insert-or-ignore, then update where the session differs)
 * rather than diffing an in-memory copy of `score_metrics`.
 */
function reconcileBuckets(
  db: Db,
  opts: {
    buckets: Bucket[];
    priorSessions: number[][];
    candidates: SessionRow[];
    takenNames: Set<string>;
  },
): SessionEngineResult {
  const { buckets, priorSessions, candidates, takenNames } = opts;
  const started: number[] = [];
  const finished: number[] = [];
  const candidateById = new Map(candidates.map((s) => [s.id, s]));
  const claimedSessionIds = new Set<number>();
  const now = Date.now();

  const assignName = (sessionId: number): string => {
    const name = generateSessionName(sessionId, takenNames);
    takenNames.add(name);
    return name;
  };

  db.transaction((tx) => {
    buckets.forEach((bucket, bucketIndex) => {
      const isOpen = now - bucket.endedAt.getTime() <= SESSION_GAP_MS;

      // Prefer the earliest score's prior session, then any unclaimed match.
      let sessionId: number | null = null;
      for (const prev of priorSessions[bucketIndex] ?? []) {
        if (candidateById.has(prev) && !claimedSessionIds.has(prev)) {
          sessionId = prev;
          break;
        }
      }

      const prevRow =
        sessionId != null ? candidateById.get(sessionId) : undefined;
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

      for (const ids of chunked(bucket.scoreIds)) {
        tx.insert(scoreMetrics)
          .values(
            ids.map((scoreId) => ({
              scoreId,
              retryIndex: 0,
              isPb: false,
              sessionId: sessionId!,
            })),
          )
          .onConflictDoNothing()
          .run();
        tx.update(scoreMetrics)
          .set({ sessionId })
          .where(
            and(
              inArray(scoreMetrics.scoreId, ids),
              sql`${scoreMetrics.sessionId} IS NOT ${sessionId}`,
            ),
          )
          .run();
      }
    });

    // Delete only after every score was re-pointed; metrics rows of scores
    // outside the scope may still reference an orphan (foreign key).
    const orphanIds = candidates
      .map((s) => s.id)
      .filter((id) => !claimedSessionIds.has(id));
    for (const ids of chunked(orphanIds)) {
      tx.update(scoreMetrics)
        .set({ sessionId: null })
        .where(inArray(scoreMetrics.sessionId, ids))
        .run();
      tx.delete(sessions).where(inArray(sessions.id, ids)).run();
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

/**
 * Delta repair for newly extracted scores.
 *
 * Sessions are contiguous blocks of the global timeline split by gaps larger
 * than `SESSION_GAP_MS`, so inserting scores can only reshape the sessions
 * within one gap of them (plus the open session, which is always re-evaluated
 * so it closes once it goes stale). This re-buckets just those sessions' scores
 * together with the new scores and reconciles them with the same routine the
 * full rebuild uses, which covers gaps inside the batch, scores older than the
 * open session, closing the open session and opening a new one, and scores
 * that merge or extend closed sessions.
 *
 * Returns null (caller does the full rebuild) when `sessions.score_count` does
 * not add up to the scoped scores outside the repaired window, i.e. the stored
 * sessions are not a trustworthy partition of the timeline.
 */
export async function tryRepairSessionDelta(
  db: Db,
  scoreIds: string[],
): Promise<SessionEngineResult | null> {
  if (scoreIds.length === 0) return null;

  const scope = await scopedScoresWhere(db);
  const scoreColumns = {
    id: scores.id,
    playedAt: scores.playedAt,
    rulesetShortName: scores.rulesetShortName,
  };

  const deltaRows: ScopedScoreRow[] = [];
  for (const ids of chunked([...new Set(scoreIds)])) {
    deltaRows.push(
      ...(await db
        .select(scoreColumns)
        .from(scores)
        .where(and(inArray(scores.id, ids), scope))),
    );
  }
  if (deltaRows.length === 0) return { started: [], finished: [] };
  deltaRows.sort(compareScoreRows);

  const allSessions = await db.select().from(sessions);
  const deltaTimes = deltaRows.map((r) => toMs(r.playedAt));

  // First delta time at or after `target`.
  const lowerBound = (target: number): number => {
    let lo = 0;
    let hi = deltaTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (deltaTimes[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const affectedIds = new Set<number>();
  for (const session of allSessions) {
    if (session.endedAt == null) {
      affectedIds.add(session.id);
      continue;
    }
    const idx = lowerBound(toMs(session.startedAt) - SESSION_GAP_MS);
    if (
      idx < deltaTimes.length &&
      deltaTimes[idx]! <= toMs(session.endedAt) + SESSION_GAP_MS
    ) {
      affectedIds.add(session.id);
    }
  }

  // Sessions the new scores are already attached to (re-extracted scores).
  for (const ids of chunked(deltaRows.map((r) => r.id))) {
    const attached = await db
      .select({ sessionId: scoreMetrics.sessionId })
      .from(scoreMetrics)
      .where(inArray(scoreMetrics.scoreId, ids));
    for (const row of attached) {
      if (row.sessionId != null) affectedIds.add(row.sessionId);
    }
  }

  const windowById = new Map(deltaRows.map((r) => [r.id, r] as const));
  for (const ids of chunked([...affectedIds])) {
    const rows = await db
      .select(scoreColumns)
      .from(scoreMetrics)
      .innerJoin(scores, eq(scores.id, scoreMetrics.scoreId))
      .where(and(inArray(scoreMetrics.sessionId, ids), scope));
    for (const row of rows) windowById.set(row.id, row);
  }
  const windowRows = [...windowById.values()].sort(compareScoreRows);

  const [totals] = await db.select({ n: count() }).from(scores).where(scope);
  let outsideWindow = 0;
  for (const session of allSessions) {
    if (!affectedIds.has(session.id)) outsideWindow += session.scoreCount;
  }
  if (Number(totals?.n ?? 0) !== outsideWindow + windowRows.length) return null;

  const buckets = bucketScoreRows(windowRows);
  return reconcileBuckets(db, {
    buckets,
    priorSessions: await loadPriorSessionsByBucket(db, buckets),
    candidates: allSessions.filter((s) => affectedIds.has(s.id)),
    takenNames: collectTakenNames(allSessions),
  });
}

/**
 * Group scores into sessions by 30-minute inactivity gaps.
 * Reuses existing session IDs when buckets still map to the same scores,
 * so IDs stay stable across analytics rebuilds. With `scoreIds`, tries the
 * delta repair first and falls back to the full rebuild.
 */
export async function runSessionEngine(
  db: Db,
  options?: SessionEngineOptions,
): Promise<SessionEngineResult> {
  await backfillSessionNames(db);

  if (options?.scoreIds && options.scoreIds.length > 0) {
    const delta = await tryRepairSessionDelta(db, options.scoreIds);
    if (delta) return delta;
  }

  const rows = await db
    .select({
      id: scores.id,
      playedAt: scores.playedAt,
      rulesetShortName: scores.rulesetShortName,
    })
    .from(scores)
    .where(await scopedScoresWhere(db))
    .orderBy(asc(scores.playedAt), asc(scores.id));

  const existingSessions = await db.select().from(sessions);

  if (rows.length === 0) {
    db.transaction((tx) => {
      tx.update(scoreMetrics)
        .set({ sessionId: null })
        .where(isNotNull(scoreMetrics.sessionId))
        .run();
      if (existingSessions.length > 0) {
        tx.delete(sessions).run();
      }
    });
    return { started: [], finished: [] };
  }

  const buckets = bucketScoreRows(rows);
  return reconcileBuckets(db, {
    buckets,
    priorSessions: await loadPriorSessionsByBucket(db, buckets),
    candidates: existingSessions,
    takenNames: collectTakenNames(existingSessions),
  });
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
      onlineId: scores.onlineId,
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
      statistics: scores.statistics,
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
      reworkEstDiff: reworkEstDiffSelect(),
      reworkStar: reworkStarSelect(),
      reworkLnRatio: reworkLnRatioSelect(),
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
