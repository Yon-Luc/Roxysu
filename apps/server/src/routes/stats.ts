import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import {
  getPlayerStats,
  parseGranularity,
  parseRange,
  parseSkillTopPlays,
} from "../analytics/playerStats";
import { toIso } from "../shared/serialize";

export const statsRoutes = new Elysia({ prefix: "/stats" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query }) => {
      const granularity = parseGranularity(query.granularity);
      const range = parseRange(query.range);
      const skillTopPlays = parseSkillTopPlays(query.skillTopPlays);
      const data = await getPlayerStats(db, {
        granularity,
        range,
        skillTopPlays,
      });

      return {
        ...data,
        summary: {
          ...data.summary,
          firstPlayedAt: toIso(data.summary.firstPlayedAt),
          lastPlayedAt: toIso(data.summary.lastPlayedAt),
        },
        sessionStats: {
          ...data.sessionStats,
          longest: data.sessionStats.longest
            ? {
                ...data.sessionStats.longest,
                startedAt: toIso(data.sessionStats.longest.startedAt),
                endedAt: toIso(data.sessionStats.longest.endedAt),
              }
            : null,
        },
      };
    },
    {
      query: t.Object({
        granularity: t.Optional(
          t.Union([t.Literal("day"), t.Literal("week")]),
        ),
        range: t.Optional(t.Union([t.Number(), t.String()])),
        skillTopPlays: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  );
