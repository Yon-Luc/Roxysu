import { Elysia, t } from "elysia";
import { and, count, desc, eq, like, max, or, sql } from "drizzle-orm";
import { beatmaps, mastery, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { looksLikeQuery, searchBeatmaps, QueryParseError } from "../query-language";

function mapCard(r: {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  lastPlayedAt: number | Date | null;
  masteryLevel?: number | null;
}) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    difficultyName: r.difficultyName,
    starRating: r.starRating,
    bpm: r.bpm,
    rulesetShortName: r.rulesetShortName,
    mapperUsername: r.mapperUsername,
    playCount: Number(r.playCount ?? 0),
    bestAccuracy: r.bestAccuracy ?? null,
    bestPp: r.bestPp ?? null,
    lastPlayedAt: toIso(r.lastPlayedAt),
    masteryLevel: r.masteryLevel ?? null,
  };
}

export const practiceRoutes = new Elysia({ prefix: "/practice" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query, set }) => {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
      const q = query.q?.trim();

      if (q && looksLikeQuery(q)) {
        try {
          const result = searchBeatmaps(db, q, { page, pageSize });
          return {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            queryMode: "structured" as const,
            items: result.items.map((r) =>
              mapCard({
                ...r,
                lastPlayedAt: r.lastPlayedAt,
              }),
            ),
          };
        } catch (err) {
          if (err instanceof QueryParseError) {
            set.status = 400;
            return { error: err.message };
          }
          throw err;
        }
      }

      const offset = (page - 1) * pageSize;

      const playStats = db
        .select({
          beatmapId: scores.beatmapId,
          playCount: count(scores.id).as("play_count"),
          bestAccuracy: max(scores.accuracy).as("best_accuracy"),
          bestPp: max(scores.pp).as("best_pp"),
          lastPlayedAt: max(scores.playedAt).as("last_played_at"),
        })
        .from(scores)
        .where(
          and(sql`${scores.beatmapId} IS NOT NULL`, eq(scores.deletePending, false)),
        )
        .groupBy(scores.beatmapId)
        .as("play_stats");

      const searchFilter = q
        ? or(
            like(beatmaps.title, `%${q}%`),
            like(beatmaps.artist, `%${q}%`),
            like(beatmaps.mapperUsername, `%${q}%`),
            like(beatmaps.difficultyName, `%${q}%`),
          )
        : undefined;

      const whereClause = searchFilter
        ? and(eq(beatmaps.hidden, false), searchFilter)
        : eq(beatmaps.hidden, false);

      const [totalRow] = await db
        .select({ n: count() })
        .from(beatmaps)
        .where(whereClause);

      const rows = await db
        .select({
          id: beatmaps.id,
          title: beatmaps.title,
          artist: beatmaps.artist,
          difficultyName: beatmaps.difficultyName,
          starRating: beatmaps.starRating,
          bpm: beatmaps.bpm,
          rulesetShortName: beatmaps.rulesetShortName,
          mapperUsername: beatmaps.mapperUsername,
          lastPlayed: beatmaps.lastPlayed,
          playCount: playStats.playCount,
          bestAccuracy: playStats.bestAccuracy,
          bestPp: playStats.bestPp,
          lastPlayedAt: playStats.lastPlayedAt,
          masteryLevel: mastery.level,
        })
        .from(beatmaps)
        .leftJoin(playStats, eq(beatmaps.id, playStats.beatmapId))
        .leftJoin(mastery, eq(beatmaps.id, mastery.beatmapId))
        .where(whereClause)
        .orderBy(
          sql`COALESCE(${playStats.lastPlayedAt}, ${beatmaps.lastPlayed}) DESC NULLS LAST`,
        )
        .limit(pageSize)
        .offset(offset);

      return {
        page,
        pageSize,
        total: totalRow?.n ?? 0,
        queryMode: "text" as const,
        items: rows.map((r) =>
          mapCard({
            ...r,
            lastPlayedAt: r.lastPlayedAt ?? r.lastPlayed,
            masteryLevel: r.masteryLevel,
          }),
        ),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        pageSize: t.Optional(t.Numeric()),
        q: t.Optional(t.String()),
      }),
    },
  );
