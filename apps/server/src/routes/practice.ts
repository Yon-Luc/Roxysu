import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import {
  looksLikeQuery,
  searchBeatmaps,
  sampleBeatmaps,
  practiceDistribution,
  practicePatternSummary,
  QueryParseError,
  toStructuredQuery,
  type PracticeSortBy,
  type PracticeSortDir,
  type PracticeMetric,
} from "../query-language";
import { recommendSevenK } from "../analytics/recommend";
import { parseSkillTopPlays } from "../analytics/recommend/sevenKSkill";

const SORT_BY = [
  "lastPlayed",
  "accuracy",
  "misses",
  "score",
  "pp",
  "mastery",
  "stars",
] as const satisfies readonly PracticeSortBy[];

const SORT_DIR = ["asc", "desc"] as const satisfies readonly PracticeSortDir[];

const METRICS = [
  "accuracy",
  "misses",
  "score",
] as const satisfies readonly PracticeMetric[];

function parseSortBy(value: string | undefined): PracticeSortBy {
  return (SORT_BY as readonly string[]).includes(value ?? "")
    ? (value as PracticeSortBy)
    : "lastPlayed";
}

function parseSortDir(value: string | undefined): PracticeSortDir {
  return (SORT_DIR as readonly string[]).includes(value ?? "")
    ? (value as PracticeSortDir)
    : "desc";
}

function parseMetric(value: string | undefined): PracticeMetric {
  return (METRICS as readonly string[]).includes(value ?? "")
    ? (value as PracticeMetric)
    : "accuracy";
}

function mapCard(r: {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  onlineId: number | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  bestScore: number | null;
  bestMisses: number | null;
  lastPlayedAt: number | Date | null;
  masteryLevel?: number | null;
  sunnyEstDiff?: string | null;
  sunnyStar?: number | null;
  danielEstDiff?: string | null;
  danielStar?: number | null;
  keyCount?: number | null;
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
    onlineId: r.onlineId,
    setOnlineId: r.setOnlineId,
    backgroundFileHash: r.backgroundFileHash,
    playCount: Number(r.playCount ?? 0),
    bestAccuracy: r.bestAccuracy ?? null,
    bestPp: r.bestPp ?? null,
    bestScore: r.bestScore ?? null,
    bestMisses: r.bestMisses ?? null,
    lastPlayedAt: toIso(r.lastPlayedAt),
    masteryLevel: r.masteryLevel ?? null,
    sunnyEstDiff: r.sunnyEstDiff ?? null,
    sunnyStar: r.sunnyStar ?? null,
    danielEstDiff: r.danielEstDiff ?? null,
    danielStar: r.danielStar ?? null,
    keyCount: r.keyCount ?? null,
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
      const sortBy = parseSortBy(query.sortBy);
      const sortDir = parseSortDir(query.sortDir);
      const structured = toStructuredQuery(q);
      const queryMode =
        q && looksLikeQuery(q) ? ("structured" as const) : ("text" as const);

      try {
        const result = searchBeatmaps(db, structured, {
          page,
          pageSize,
          sortBy,
          sortDir,
        });
        return {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          sortBy,
          sortDir,
          queryMode,
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
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        pageSize: t.Optional(t.Numeric()),
        q: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/sample",
    async ({ db, query, set }) => {
      const q = query.q?.trim();
      const count = Math.max(1, Math.min(20, query.count ?? 3));
      const structured = toStructuredQuery(q);
      const exclude = (query.exclude ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      try {
        const result = sampleBeatmaps(db, structured, {
          count,
          excludeIds: exclude,
        });
        return {
          total: result.total,
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
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        count: t.Optional(t.Numeric()),
        exclude: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/distribution",
    async ({ db, query, set }) => {
      const q = query.q?.trim();
      const metric = parseMetric(query.metric);
      const structured = toStructuredQuery(q);

      try {
        return practiceDistribution(db, structured, metric);
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
        metric: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/patterns",
    ({ db, query }) => {
      const samplesPerPattern = Math.max(
        1,
        Math.min(8, Math.floor(query.samples ?? 5)),
      );
      const axis = query.axis?.trim().toLowerCase();
      const keymode = query.keymode;
      return practicePatternSummary(db, {
        samplesPerPattern,
        axis,
        keymode,
      });
    },
    {
      query: t.Object({
        samples: t.Optional(t.Numeric()),
        axis: t.Optional(t.String()),
        keymode: t.Optional(t.Numeric()),
      }),
    },
  )
  .get(
    "/recommend",
    async ({ db, query, set }) => {
      const exclude = (query.exclude ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      try {
        const batch = recommendSevenK(db, {
          focus: query.focus,
          skillset: query.skillset,
          count: query.count ?? 10,
          excludeIds: exclude,
          q: query.q?.trim() || undefined,
          topPlays: parseSkillTopPlays(query.topPlays),
        });

        return {
          focus: batch.focus,
          targetSkillset: batch.targetSkillset,
          skill: batch.skill,
          skillTopPlays: batch.skillTopPlays,
          summary: batch.summary,
          totalMapsConsidered: batch.totalMapsConsidered,
          needsSunnyBackfill: batch.needsSunnyBackfill,
          recommendations: batch.recommendations.map((r) => ({
            ...mapCard({
              id: r.id,
              title: r.title,
              artist: r.artist,
              difficultyName: r.difficultyName,
              starRating: r.starRating,
              bpm: r.bpm,
              rulesetShortName: r.rulesetShortName,
              mapperUsername: r.mapperUsername,
              onlineId: r.onlineId,
              setOnlineId: r.setOnlineId,
              backgroundFileHash: r.backgroundFileHash,
              playCount: r.playCount,
              bestAccuracy: r.bestAccuracy,
              bestPp: r.bestPp,
              bestScore: r.bestScore,
              bestMisses: r.bestMisses,
              lastPlayedAt: r.lastPlayedAt,
              masteryLevel: r.masteryLevel,
              sunnyEstDiff: r.sunnyEstDiff,
              sunnyStar: r.sunnyStar,
            }),
            relativeDifficulty: r.relativeDifficulty,
            confidence: r.confidence,
            mmr: r.mmr,
            lnRatio: r.lnRatio,
            axis: r.axis,
            reasoning: r.reasoning,
            targetSkillset: r.targetSkillset,
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
        focus: t.Optional(t.String()),
        skillset: t.Optional(t.String()),
        count: t.Optional(t.Numeric()),
        exclude: t.Optional(t.String()),
        q: t.Optional(t.String()),
        topPlays: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  );
