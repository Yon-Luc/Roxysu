import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import {
  countSessionPbs,
  getCurrentSession,
  getSessionById,
  listSessionScores,
  listSessions,
  listSessionsOnUtcDay,
} from "../analytics/session";
import { getCalendarActivity } from "../analytics/progression";
import { clampTzOffset } from "../shared/localDay";
import {
  loadManiaPpCurves,
  resolveScorePp,
} from "../mania-rating/estimateScorePp";
import { parseScoreStatistics } from "../scores/parseStatistics";
import {
  loadPbCompareForBeatmaps,
  pickPbCompare,
} from "../scores/pbCompare";

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

/**
 * S-NEW-1: the sessions list handler never defaults to "every session".
 * Without a cap, a long-lived library serialized the full table on every
 * page visit and command-palette warm-up. The default restores the
 * pre-regression behavior; `?limit=` can raise it up to the hard max.
 */
export const DEFAULT_SESSION_LIST_LIMIT = 100;
export const MAX_SESSION_LIST_LIMIT = 500;

export function clampSessionListLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SESSION_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_SESSION_LIST_LIMIT);
}

/**
 * UI-N1: a calendar-day drill-down must not inherit the 100-row index cap —
 * one busy day would silently drop the rest. The day list pages up to the same
 * hard max as an explicit `?limit=`, and `hasMore` still reports truncation.
 */
export function clampSessionDayLimit(raw: unknown): number {
  if (raw == null || raw === "") return MAX_SESSION_LIST_LIMIT;
  const n = typeof raw === "number" ? raw : Number(raw);
  // An unparsable day limit still gets the day cap, never the index cap.
  if (!Number.isFinite(n) || n < 1) return MAX_SESSION_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_SESSION_LIST_LIMIT);
}

/** One page plus the `hasMore` flag, same shape as the score-detail route. */
function pageWithHasMore<T>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
  };
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
  const beatmapIds = scoreRows
    .map((score) => score.beatmapId)
    .filter((beatmapId): beatmapId is string => beatmapId != null);
  const [curves, pbTops] = await Promise.all([
    loadManiaPpCurves(db, beatmapIds),
    loadPbCompareForBeatmaps(db, beatmapIds),
  ]);

  return {
    session: serializeSession(session),
    pbCount,
    hasMore,
    scores: scoreRows.map((s) => {
      const pp = resolveScorePp({
        pp: s.pp,
        accuracy: s.accuracy,
        mods: s.mods,
        rulesetShortName: s.rulesetShortName,
        curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
        rank: s.rank,
      });
      const rawCompare =
        s.beatmapId != null
          ? pickPbCompare({
              isPb: Boolean(s.isPb),
              scoreId: s.id,
              top: pbTops.get(s.beatmapId),
            })
          : null;
      const pbCompare = rawCompare
        ? {
            kind: rawCompare.kind,
            id: rawCompare.id,
            accuracy: rawCompare.accuracy,
            pp: resolveScorePp({
              pp: rawCompare.pp,
              accuracy: rawCompare.accuracy,
              mods: rawCompare.mods,
              rulesetShortName: s.rulesetShortName,
              curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
              rank: rawCompare.rank,
            }),
            maxCombo: rawCompare.maxCombo,
            mods: rawCompare.mods,
            rank: rawCompare.rank,
            playedAt: toIso(rawCompare.playedAt)!,
          }
        : null;

      return {
        id: s.id,
        onlineId: s.onlineId > 0 ? s.onlineId : null,
        beatmapId: s.beatmapId,
        accuracy: s.accuracy,
        pp,
        maxCombo: s.maxCombo,
        mods: s.mods,
        rank: s.rank,
        totalScore: s.totalScore,
        rulesetShortName: s.rulesetShortName,
        playedAt: toIso(s.playedAt)!,
        isPb: s.isPb,
        retryIndex: s.retryIndex,
        hasReplay: Boolean(s.replayFileHash),
        judgments: parseScoreStatistics(s.statistics),
        pbCompare,
        title: s.title,
        artist: s.artist,
        difficultyName: s.difficultyName,
        starRating: s.starRating,
        keyCount: s.keyCount != null ? Math.round(Number(s.keyCount)) : null,
        reworkEstDiff: s.reworkEstDiff ?? null,
        reworkStar: s.reworkStar != null ? Number(s.reworkStar) : null,
        reworkLnRatio: s.reworkLnRatio != null ? Number(s.reworkLnRatio) : null,
        setOnlineId:
          s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
        backgroundFileHash: s.backgroundFileHash,
      };
    }),
  };
}

export const sessionRoutes = new Elysia({ prefix: "/sessions" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query }) => {
      const day = query.day?.trim();
      const tzOffset = clampTzOffset(query.tzOffset);
      // S-NEW-1: both branches pass a limit — never the unbounded
      // `listSessions(db)` / `listSessionsOnUtcDay(db, day, undefined, …)`.
      // Fetch one extra row to report `hasMore` without a count query.
      const limit = day
        ? clampSessionDayLimit(query.limit)
        : clampSessionListLimit(query.limit);
      const fetchLimit = Math.min(limit + 1, MAX_SESSION_LIST_LIMIT + 1);
      if (day) {
        const rows = await listSessionsOnUtcDay(
          db,
          day,
          fetchLimit,
          tzOffset,
        );
        const { items, hasMore } = pageWithHasMore(rows, limit);
        return {
          current: null,
          items: items.map(serializeSession),
          hasMore,
          activity: [],
        };
      }
      const [rows, current, activity] = await Promise.all([
        listSessions(db, fetchLimit),
        getCurrentSession(db),
        getCalendarActivity(db, 371, tzOffset),
      ]);
      const { items, hasMore } = pageWithHasMore(rows, limit);
      return {
        current: current ? serializeSession(current) : null,
        items: items.map(serializeSession),
        hasMore,
        activity,
      };
    },
    {
      query: t.Object({
        day: t.Optional(t.String()),
        tzOffset: t.Optional(t.Union([t.Number(), t.String()])),
        limit: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  )
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

