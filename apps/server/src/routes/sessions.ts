import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import {
  getCurrentSession,
  getSessionById,
  listSessionScores,
  listSessions,
} from "../analytics/session";

function serializeSession(s: {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
  scoreCount: number;
  rulesetShortName: string | null;
}) {
  return {
    id: s.id,
    startedAt: toIso(s.startedAt)!,
    endedAt: toIso(s.endedAt),
    scoreCount: s.scoreCount,
    rulesetShortName: s.rulesetShortName,
    isCurrent: s.endedAt == null,
  };
}

async function sessionDetailPayload(
  db: Parameters<typeof listSessionScores>[0],
  session: NonNullable<Awaited<ReturnType<typeof getSessionById>>>,
) {
  const scoreRows = await listSessionScores(db, session.id);
  const pbCount = scoreRows.filter((s) => s.isPb).length;

  return {
    session: serializeSession(session),
    pbCount,
    scores: scoreRows.map((s) => ({
      id: s.id,
      beatmapId: s.beatmapId,
      accuracy: s.accuracy,
      pp: s.pp,
      maxCombo: s.maxCombo,
      mods: s.mods,
      rank: s.rank,
      totalScore: s.totalScore,
      rulesetShortName: s.rulesetShortName,
      playedAt: toIso(s.playedAt)!,
      isPb: s.isPb,
      retryIndex: s.retryIndex,
      title: s.title,
      artist: s.artist,
      difficultyName: s.difficultyName,
      starRating: s.starRating,
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
    async ({ db, params, set }) => {
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
            idle: true as const,
          };
        }
        set.status = 404;
        return { error: "Session not found" };
      }

      return sessionDetailPayload(db, session);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );

