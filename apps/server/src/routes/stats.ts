import { Elysia, t } from "elysia";
import type { Db } from "@roxysu/db/types";
import { dbPlugin } from "../db-runtime";
import {
  getPlayerStats,
  parseGranularity,
  parseRange,
  parseSkillTopPlays,
  type StatsGranularity,
  type StatsRange,
} from "../analytics/playerStats";
import {
  getCachedPlayerStats,
  playerStatsCacheKey,
  setCachedPlayerStats,
} from "../analytics/playerStatsCache";
import { toIso } from "../shared/serialize";
import {
  getSkillBandPlays,
  type SkillBandAxis,
} from "../analytics/skillBandPlays";

async function buildStatsResponse(
  db: Db,
  opts: {
    granularity: StatsGranularity;
    range: StatsRange;
    skillTopPlays: number;
  },
) {
  const data = await getPlayerStats(db, opts);
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
}

type StatsResponse = Awaited<ReturnType<typeof buildStatsResponse>>;

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
      const cacheKey = playerStatsCacheKey({
        granularity,
        range,
        skillTopPlays,
      });

      const cached = getCachedPlayerStats<StatsResponse>(cacheKey);
      if (cached) return cached;

      const payload = await buildStatsResponse(db, {
        granularity,
        range,
        skillTopPlays,
      });
      setCachedPlayerStats(cacheKey, payload);
      return payload;
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
