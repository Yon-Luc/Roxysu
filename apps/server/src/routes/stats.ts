import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import {
  getPlayerStats,
  parseGranularity,
  parseRange,
  parseSkillTopPlays,
} from "../analytics/playerStats";
import { toIso } from "../shared/serialize";
import {
  getSkillBandPlays,
  type SkillBandAxis,
  type SkillBandKind,
} from "../analytics/skillBandPlays";

export const statsRoutes = new Elysia({ prefix: "/stats" })
  .use(dbPlugin)
  .get(
    "/skill-plays",
    ({ db, query }) => {
      const axis: SkillBandAxis =
        query.axis === "rc" || query.axis === "ln" || query.axis === "fln"
          ? query.axis
          : "all";
      const result = getSkillBandPlays(db, {
        band: query.band,
        axis,
        topPlays: parseSkillTopPlays(query.topPlays),
      });
      return {
        ...result,
        inBand: result.inBand.map((p) => ({
          ...p,
          playedAt: toIso(p.playedAt),
        })),
        inNextDan: result.inNextDan.map((p) => ({
          ...p,
          playedAt: toIso(p.playedAt),
        })),
      };
    },
    {
      query: t.Object({
        band: t.Union([
          t.Literal("push"),
          t.Literal("accuracy"),
          t.Literal("consistency"),
        ]),
        axis: t.Optional(
          t.Union([
            t.Literal("all"),
            t.Literal("rc"),
            t.Literal("ln"),
            t.Literal("fln"),
          ]),
        ),
        topPlays: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  )
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
