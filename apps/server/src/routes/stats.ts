import { Elysia, t } from "elysia";
import type { Db } from "@roxysu/db/types";
import { dbPlugin } from "../db-runtime";
import {
  getPlayedKeyModes,
  getPlayerStats,
  parseGranularity,
  parseSkillTopPlays,
  type StatsGranularity,
} from "../analytics/playerStats";
import {
  getCachedPlayerStats,
  playerStatsCacheKey,
  setCachedPlayerStats,
} from "../analytics/playerStatsCache";
import { resolveScoresUsernamesSync, scoresUsernameCacheKey } from "../analytics/scoreUsername";
import {
  resolveScoresGamemodeSync,
  scoresGamemodeCacheKey,
} from "../analytics/scoreGamemode";
import { toIso } from "../shared/serialize";
import {
  getSkillBandPlays,
  type SkillBandAxis,
} from "../analytics/skillBandPlays";

/**
 * Like `parseSkillKeyCount`, but keeps an omitted / empty / invalid key count
 * as `undefined` so `getPlayerStats` can resolve the player's preferred
 * keymode. Pre-defaulting to 7 here would make the fallback unreachable (and
 * cache the 7K payload under the wrong key).
 */
function parseOptionalSkillKeyCount(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 18) return undefined;
  return rounded;
}

async function buildStatsResponse(
  db: Db,
  opts: {
    granularity: StatsGranularity;
    skillTopPlays: number;
    keyCount?: number;
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
        // Omitted keyCount: follow the same preferred-key fallback as
        // `GET /stats`, so the Patterns panel does not start on 7K and jump.
        keyCount:
          parseOptionalSkillKeyCount(query.keyCount) ??
          getPlayedKeyModes(db).preferredKeyCount,
        shape: query.shape?.trim() || undefined,
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
        keyCount: t.Optional(t.Union([t.Number(), t.String()])),
        shape: t.Optional(t.String()),
      }),
    },
  )
  .get("/keys", ({ db }) => getPlayedKeyModes(db))
  .get(
    "/",
    async ({ db, query }) => {
      const granularity = parseGranularity(query.granularity);
      const skillTopPlays = parseSkillTopPlays(query.skillTopPlays);
      const keyCount = parseOptionalSkillKeyCount(query.keyCount);
      const usernames = resolveScoresUsernamesSync(db);
      const gamemode = resolveScoresGamemodeSync(db);
      const cacheParts = {
        granularity,
        skillTopPlays,
        username: scoresUsernameCacheKey(usernames),
        gamemode: scoresGamemodeCacheKey(gamemode),
      };
      // An omitted keyCount is resolved inside getPlayerStats, so only an
      // explicit key can be used for the lookup. The built payload is cached
      // under its resolved keyCount below, which covers the native key too.
      if (keyCount != null) {
        const cached = getCachedPlayerStats<StatsResponse>(
          playerStatsCacheKey({ ...cacheParts, keyCount }),
        );
        if (cached) return cached;
      }

      const payload = await buildStatsResponse(db, {
        granularity,
        skillTopPlays,
        keyCount,
      });
      // Cache under the resolved keymode (payload.keyCount), never the 7K
      // pre-default, so a later explicit ?keyCount=<preferred> hits this entry.
      setCachedPlayerStats(
        playerStatsCacheKey({ ...cacheParts, keyCount: payload.keyCount }),
        payload,
      );
      return payload;
    },
    {
      query: t.Object({
        granularity: t.Optional(
          t.Union([t.Literal("day"), t.Literal("week")]),
        ),
        // Legacy `range` query param ignored — stats are always all-time.
        skillTopPlays: t.Optional(t.Union([t.Number(), t.String()])),
        keyCount: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  );
