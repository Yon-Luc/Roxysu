import { beatmapSets, beatmaps, scores } from "@roxysu/db/schema";
import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";

import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import { getCurrentSession, listSessionScores } from "../analytics/session";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";
import {
  loadManiaPpCurves,
  resolveScorePp,
  type ManiaPpCurve,
} from "../mania-rating/estimateScorePp";
import {
  readOverlayProfiles,
  sanitizeOverlayProfile,
  writeOverlayProfiles,
} from "../overlay/profiles";

export const DEFAULT_OVERLAY_LIMIT = 8;
export const MAX_OVERLAY_LIMIT = 25;

export function clampOverlayLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_OVERLAY_LIMIT;
  return Math.min(Math.floor(n), MAX_OVERLAY_LIMIT);
}

type OverlayScoreRow = {
  id: string;
  beatmapId: string | null;
  accuracy: number | null;
  pp: number | null;
  mods: string | null;
  rulesetShortName: string | null;
  playedAt: Date | number | null;
  isPb?: boolean | null;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
};

function serializeOverlayScore(
  s: OverlayScoreRow,
  curves: Map<string, ManiaPpCurve>,
) {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    difficultyName: s.difficultyName,
    accuracy: s.accuracy,
    pp: resolveScorePp({
      pp: s.pp,
      accuracy: s.accuracy ?? 0,
      mods: s.mods,
      rulesetShortName: s.rulesetShortName,
      curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
    }),
    mods: s.mods,
    playedAt: toIso(s.playedAt),
    isPb: Boolean(s.isPb),
    setOnlineId:
      s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
    backgroundFileHash: s.backgroundFileHash,
  };
}

async function overlayCurves(
  db: Parameters<typeof loadManiaPpCurves>[0],
  rows: OverlayScoreRow[],
) {
  return loadManiaPpCurves(
    db,
    rows
      .map((score) => score.beatmapId)
      .filter((beatmapId): beatmapId is string => beatmapId != null),
  );
}

async function listRecentOverlayScores(
  db: Parameters<typeof listSessionScores>[0],
  limit: number,
): Promise<OverlayScoreRow[]> {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const scoreScope = and(
    eq(scores.deletePending, false),
    scoresUsernameCondition(usernames),
    scoresGamemodeCondition(gamemode),
  );

  return db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      mods: scores.mods,
      rulesetShortName: scores.rulesetShortName,
      playedAt: scores.playedAt,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      setOnlineId: beatmapSets.onlineId,
      backgroundFileHash: beatmaps.backgroundFileHash,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(scoreScope)
    .orderBy(desc(scores.playedAt))
    .limit(limit);
}

export const overlayRoutes = new Elysia({ prefix: "/overlay" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query }) => {
      const limit = clampOverlayLimit(query.limit);
      const current = await getCurrentSession(db);

      const profileRef = query.profile?.trim() || undefined;
      let profile = null;
      if (profileRef) {
        const profiles = await readOverlayProfiles(db);
        const needle = profileRef.toLowerCase();
        profile =
          profiles.find(
            (p) =>
              p.id.toLowerCase() === needle || p.name.toLowerCase() === needle,
          ) ?? null;
      }

      const base = { profile };

      if (current) {
        const scoreRows = await listSessionScores(db, current.id, { limit });
        const curves = await overlayCurves(db, scoreRows);
        return {
          ...base,
          mode: "live" as const,
          session: {
            id: current.id,
            name: current.name,
            scoreCount: current.scoreCount,
          },
          scores: scoreRows.map((s) => serializeOverlayScore(s, curves)),
        };
      }

      const recent = await listRecentOverlayScores(db, limit);
      if (recent.length === 0) {
        return {
          ...base,
          mode: "empty" as const,
          session: null,
          scores: [],
        };
      }

      const curves = await overlayCurves(db, recent);
      return {
        ...base,
        mode: "recent" as const,
        session: null,
        scores: recent.map((s) => serializeOverlayScore(s, curves)),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        profile: t.Optional(t.String()),
      }),
    },
  )
  .get("/profiles", async ({ db }) => ({
    profiles: await readOverlayProfiles(db),
  }))
  .put(
    "/profiles/:id",
    async ({ db, params, body }) => {
      const incoming = sanitizeOverlayProfile({ ...body, id: params.id });
      if (!incoming) {
        return new Response(JSON.stringify({ error: "invalid profile" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const profiles = await readOverlayProfiles(db);
      const idx = profiles.findIndex((p) => p.id === incoming.id);
      if (idx >= 0) profiles[idx] = incoming;
      else profiles.push(incoming);
      await writeOverlayProfiles(db, profiles);
      return { profile: incoming };
    },
    { body: t.Record(t.String(), t.Unknown()) },
  )
  .delete(
    "/profiles/:id",
    async ({ db, params }) => {
      const profiles = (await readOverlayProfiles(db)).filter(
        (p) => p.id !== params.id,
      );
      await writeOverlayProfiles(db, profiles);
      return { ok: true };
    },
  );
