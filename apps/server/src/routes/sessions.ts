import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import {
  countSessionPbs,
  getCurrentSession,
  getSessionById,
  listSessionScores,
  listSessions,
} from "../analytics/session";
import {
  loadManiaPpCurves,
  resolveScorePp,
} from "../mania-rating/estimateScorePp";

function serializeSession(s: {
  id: number;
  name: string | null;
  startedAt: Date;
  endedAt: Date | null;
  scoreCount: number;
  rulesetShortName: string | null;
}) {
  return {
    id: s.id,
    name: s.name!,
    startedAt: toIso(s.startedAt)!,
    endedAt: toIso(s.endedAt),
    scoreCount: s.scoreCount,
    rulesetShortName: s.rulesetShortName,
    isCurrent: s.endedAt == null,
  };
}

export const DEFAULT_SESSION_SCORE_LIMIT = 50;
export const MAX_SESSION_SCORE_LIMIT = 500;

export function clampSessionScoreLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SESSION_SCORE_LIMIT;
  return Math.min(Math.floor(n), MAX_SESSION_SCORE_LIMIT);
}

async function sessionDetailPayload(
  db: Parameters<typeof listSessionScores>[0],
  session: NonNullable<Awaited<ReturnType<typeof getSessionById>>>,
  limit = DEFAULT_SESSION_SCORE_LIMIT,
) {
  const fetchLimit = Math.min(limit + 1, MAX_SESSION_SCORE_LIMIT + 1);
  const [scoreRowsRaw, pbCount] = await Promise.all([
    listSessionScores(db, session.id, { limit: fetchLimit }),
    countSessionPbs(db, session.id),
  ]);
  const hasMore = scoreRowsRaw.length > limit;
  const scoreRows = hasMore ? scoreRowsRaw.slice(0, limit) : scoreRowsRaw;
  const curves = await loadManiaPpCurves(
    db,
    scoreRows
      .map((score) => score.beatmapId)
      .filter((beatmapId): beatmapId is string => beatmapId != null),
  );

  return {
    session: serializeSession(session),
    pbCount,
    hasMore,
    scores: scoreRows.map((s) => ({
      id: s.id,
      beatmapId: s.beatmapId,
      accuracy: s.accuracy,
      pp: resolveScorePp({
        pp: s.pp,
        accuracy: s.accuracy,
        mods: s.mods,
        rulesetShortName: s.rulesetShortName,
        curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
      }),
      maxCombo: s.maxCombo,
      mods: s.mods,
      rank: s.rank,
      totalScore: s.totalScore,
      rulesetShortName: s.rulesetShortName,
      playedAt: toIso(s.playedAt)!,
      isPb: s.isPb,
      retryIndex: s.retryIndex,
      hasReplay: Boolean(s.replayFileHash),
      title: s.title,
      artist: s.artist,
      difficultyName: s.difficultyName,
      starRating: s.starRating,
      keyCount: s.keyCount != null ? Math.round(Number(s.keyCount)) : null,
      sunnyEstDiff: s.sunnyEstDiff ?? null,
      sunnyStar: s.sunnyStar ?? null,
      danielEstDiff: s.danielEstDiff ?? null,
      danielStar: s.danielStar != null ? Number(s.danielStar) : null,
      setOnlineId:
        s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
      backgroundFileHash: s.backgroundFileHash,
    })),
  };
}

export const sessionRoutes = new Elysia({ prefix: "/sessions" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const items = await listSessions(db, 100);
    const current = await getCurrentSession(db);
    return {
      current: current ? serializeSession(current) : null,
      items: items.map(serializeSession),
    };
  })
  .get(
    "/:id",
    async ({ db, params, query, set }) => {
      if (params.id !== "current" && Number.isNaN(Number(params.id))) {
        set.status = 404;
        return { error: "Session not found" };
      }

      const session =
        params.id === "current"
          ? await getCurrentSession(db)
          : await getSessionById(db, Number(params.id));

      if (!session) {
        if (params.id === "current") {
          return {
            session: null,
            scores: [],
            pbCount: 0,
            hasMore: false,
            idle: true as const,
          };
        }
        set.status = 404;
        return { error: "Session not found" };
      }

      return sessionDetailPayload(
        db,
        session,
        clampSessionScoreLimit(query.limit),
      );
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.Numeric()),
      }),
    },
  );

