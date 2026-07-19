import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import {
  looksLikeQuery,
  searchBeatmaps,
  sampleBeatmaps,
  practiceDistribution,
  QueryParseError,
  type PracticeSortBy,
  type PracticeSortDir,
  type PracticeMetric,
} from "../query-language";

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

function toStructuredQuery(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  if (!trimmed) return undefined;
  if (looksLikeQuery(trimmed)) return trimmed;
  return `title:${trimmed} OR artist:${trimmed} OR mapper:${trimmed} OR diff:${trimmed}`;
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
  );
