import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import {
  looksLikeQuery,
  searchBeatmaps,
  QueryParseError,
} from "../query-language";

export const searchRoutes = new Elysia({ prefix: "/search" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query, set }) => {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
      const q = query.q?.trim();

      if (!q) {
        return {
          page,
          pageSize,
          total: 0,
          items: [],
        };
      }

      const structured = looksLikeQuery(q)
        ? q
        : `title:${q} OR artist:${q} OR mapper:${q}`;

      try {
        const result = searchBeatmaps(db, structured, { page, pageSize });
        return {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          items: result.items.map((r) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            difficultyName: r.difficultyName,
            starRating: r.starRating,
            bpm: r.bpm,
            rulesetShortName: r.rulesetShortName,
            mapperUsername: r.mapperUsername,
            setOnlineId: r.setOnlineId,
            backgroundFileHash: r.backgroundFileHash,
            playCount: r.playCount,
            bestAccuracy: r.bestAccuracy,
            bestPp: r.bestPp,
            lastPlayedAt: toIso(r.lastPlayedAt),
            masteryLevel: r.masteryLevel,
          })),
        };
      } catch (err) {
        if (err instanceof QueryParseError) {
          set.status = 400;
          return { error: err.message };
        }
        throw err;
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Optional(t.Numeric()),
        pageSize: t.Optional(t.Numeric()),
      }),
    },
  );
