import type { Db } from "@roxysu/db/client.bun";
import { parseQuery } from "./parse";
import { compileQuery } from "./compile";
import type { AstNode } from "./ast";

export type PracticeCardRow = {
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
  lastPlayedAt: number | null;
  masteryLevel: number | null;
};

type SqlBinding = string | number | bigint | boolean | null;

const BASE_FROM = `
  FROM beatmaps b
  LEFT JOIN mastery m ON m.beatmap_id = b.id
  LEFT JOIN (
    SELECT
      beatmap_id,
      COUNT(*) AS play_count,
      MAX(accuracy) AS best_accuracy,
      MAX(pp) AS best_pp,
      MAX(played_at) AS last_played_at
    FROM scores
    WHERE delete_pending = 0 AND beatmap_id IS NOT NULL
    GROUP BY beatmap_id
  ) ps ON ps.beatmap_id = b.id
  LEFT JOIN (
    SELECT s.beatmap_id, MAX(sm.retry_index) AS max_retry
    FROM scores s
    JOIN score_metrics sm ON sm.score_id = s.id
    WHERE s.delete_pending = 0 AND s.beatmap_id IS NOT NULL
    GROUP BY s.beatmap_id
  ) rs ON rs.beatmap_id = b.id
  LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
`;

const SELECT_COLS = `
  b.id AS id,
  b.title AS title,
  b.artist AS artist,
  b.difficulty_name AS difficultyName,
  b.star_rating AS starRating,
  b.bpm AS bpm,
  b.ruleset_short_name AS rulesetShortName,
  b.mapper_username AS mapperUsername,
  COALESCE(ps.play_count, 0) AS playCount,
  ps.best_accuracy AS bestAccuracy,
  ps.best_pp AS bestPp,
  ps.last_played_at AS lastPlayedAt,
  m.level AS masteryLevel
`;

function baseWhere(extra: string): string {
  return `WHERE b.hidden = 0 AND COALESCE(bs.delete_pending, 0) = 0 AND (${extra})`;
}

function asBindings(params: unknown[]): SqlBinding[] {
  return params as SqlBinding[];
}

export function executeAst(
  db: Db,
  ast: AstNode,
  opts: { limit: number; offset: number },
): { items: PracticeCardRow[]; total: number } {
  const compiled = compileQuery(ast);
  const where = baseWhere(compiled.sql);
  const bindings = asBindings(compiled.params);

  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...bindings) as { n: number } | null;

  const listSql = `
    SELECT ${SELECT_COLS}
    ${BASE_FROM}
    ${where}
    ORDER BY COALESCE(ps.last_played_at, b.last_played) DESC NULLS LAST
    LIMIT ? OFFSET ?
  `;
  const items = db.$client
    .query(listSql)
    .all(...bindings, opts.limit, opts.offset) as PracticeCardRow[];

  return {
    items: items.map((r) => ({
      ...r,
      playCount: Number(r.playCount ?? 0),
      masteryLevel: r.masteryLevel != null ? Number(r.masteryLevel) : null,
    })),
    total: Number(countRow?.n ?? 0),
  };
}

export function searchBeatmaps(
  db: Db,
  query: string,
  opts: { page: number; pageSize: number },
): { items: PracticeCardRow[]; total: number; page: number; pageSize: number } {
  const ast = parseQuery(query);
  const offset = (opts.page - 1) * opts.pageSize;
  const result = executeAst(db, ast, { limit: opts.pageSize, offset });
  return {
    ...result,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

export function countMatches(db: Db, query: string): number {
  const ast = parseQuery(query);
  const compiled = compileQuery(ast);
  const where = baseWhere(compiled.sql);
  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...asBindings(compiled.params)) as { n: number } | null;
  return Number(countRow?.n ?? 0);
}
