import type { Db } from "@roxysu/db/types";
import { scores, settings } from "@roxysu/db/schema";
import {
  SCORES_GAMEMODE_ALL,
  SCORES_GAMEMODE_AUTO,
  SCORES_GAMEMODE_FILTER_KEY,
} from "@roxysu/db/settings-keys";
import { desc, eq, sql, type SQL } from "drizzle-orm";

/** Canonical osu!lazer ruleset short names. */
export const SCORE_GAMEMODE_IDS = ["osu", "taiko", "fruits", "mania"] as const;
export type ScoreGamemodeId = (typeof SCORE_GAMEMODE_IDS)[number];

export type ScoreGamemodeCount = {
  id: ScoreGamemodeId;
  label: string;
  shortLabel: string;
  count: number;
};

/** Stored preference: auto, all, or an explicit ruleset. */
export type ScoresGamemodeFilter =
  | { mode: "auto" }
  | { mode: "all" }
  | { mode: "selected"; gamemode: ScoreGamemodeId };

export const SCORE_GAMEMODE_META: Record<
  ScoreGamemodeId,
  { label: string; shortLabel: string }
> = {
  osu: { label: "Standard", shortLabel: "std" },
  taiko: { label: "Taiko", shortLabel: "taiko" },
  fruits: { label: "Catch", shortLabel: "ctb" },
  mania: { label: "Mania", shortLabel: "mania" },
};

const ALIASES: Record<string, ScoreGamemodeId> = {
  osu: "osu",
  std: "osu",
  standard: "osu",
  taiko: "taiko",
  fruits: "fruits",
  catch: "fruits",
  ctb: "fruits",
  mania: "mania",
};

export function isScoreGamemodeId(value: string): value is ScoreGamemodeId {
  return (SCORE_GAMEMODE_IDS as readonly string[]).includes(value);
}

/** Normalize user/UI aliases to a canonical ruleset short name. */
export function normalizeScoreGamemodeId(
  raw: string | null | undefined,
): ScoreGamemodeId | null {
  const key = raw?.trim().toLowerCase() ?? "";
  if (!key) return null;
  return ALIASES[key] ?? null;
}

/**
 * Parse the KV string.
 * - missing / "auto" → auto
 * - "*" → all
 * - known ruleset / alias → selected
 */
export function parseScoresGamemodeFilter(
  raw: string | null | undefined,
): ScoresGamemodeFilter {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed === SCORES_GAMEMODE_AUTO) return { mode: "auto" };
  if (trimmed === SCORES_GAMEMODE_ALL) return { mode: "all" };
  const gamemode = normalizeScoreGamemodeId(trimmed);
  if (!gamemode) return { mode: "auto" };
  return { mode: "selected", gamemode };
}

export function serializeScoresGamemodeFilter(
  filter: ScoresGamemodeFilter,
): string {
  if (filter.mode === "auto") return SCORES_GAMEMODE_AUTO;
  if (filter.mode === "all") return SCORES_GAMEMODE_ALL;
  return filter.gamemode;
}

/** Normalize PATCH body: "auto" | "*" | ruleset / alias. */
export function normalizeScoresGamemodeFilterInput(
  raw: string,
): ScoresGamemodeFilter {
  return parseScoresGamemodeFilter(raw);
}

export async function listScoreGamemodes(
  db: Db,
): Promise<ScoreGamemodeCount[]> {
  const rows = await db
    .select({
      ruleset: scores.rulesetShortName,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(scores)
    .where(eq(scores.deletePending, false))
    .groupBy(scores.rulesetShortName)
    .orderBy(desc(sql`count(*)`));

  const byId = new Map<ScoreGamemodeId, number>();
  for (const row of rows) {
    const id = normalizeScoreGamemodeId(row.ruleset);
    if (!id) continue;
    byId.set(id, (byId.get(id) ?? 0) + Number(row.count));
  }

  return SCORE_GAMEMODE_IDS.map((id) => ({
    id,
    label: SCORE_GAMEMODE_META[id].label,
    shortLabel: SCORE_GAMEMODE_META[id].shortLabel,
    count: byId.get(id) ?? 0,
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function listScoreGamemodesSync(db: Db): ScoreGamemodeCount[] {
  const rows = db.$client
    .query(
      `
      SELECT ruleset_short_name AS ruleset, COUNT(*) AS count
      FROM scores
      WHERE delete_pending = 0
      GROUP BY ruleset_short_name
      ORDER BY count DESC
    `,
    )
    .all() as Array<{ ruleset: string | null; count: number }>;

  const byId = new Map<ScoreGamemodeId, number>();
  for (const row of rows) {
    const id = normalizeScoreGamemodeId(row.ruleset);
    if (!id) continue;
    byId.set(id, (byId.get(id) ?? 0) + Number(row.count));
  }

  return SCORE_GAMEMODE_IDS.map((id) => ({
    id,
    label: SCORE_GAMEMODE_META[id].label,
    shortLabel: SCORE_GAMEMODE_META[id].shortLabel,
    count: byId.get(id) ?? 0,
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export async function getMostCommonGamemode(
  db: Db,
): Promise<ScoreGamemodeId | null> {
  const [top] = await listScoreGamemodes(db);
  return top && top.count > 0 ? top.id : null;
}

export function getMostCommonGamemodeSync(db: Db): ScoreGamemodeId | null {
  const [top] = listScoreGamemodesSync(db);
  return top && top.count > 0 ? top.id : null;
}

export async function readScoresGamemodeFilter(
  db: Db,
): Promise<ScoresGamemodeFilter> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SCORES_GAMEMODE_FILTER_KEY))
    .limit(1);
  return parseScoresGamemodeFilter(row?.value);
}

export function readScoresGamemodeFilterSync(db: Db): ScoresGamemodeFilter {
  const row = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(SCORES_GAMEMODE_FILTER_KEY) as { value: string } | null;
  return parseScoresGamemodeFilter(row?.value);
}

/**
 * Resolved ruleset to filter on, or `null` when showing all gamemodes.
 * Default ("auto") picks the ruleset with the most non-deleted scores.
 */
export async function resolveScoresGamemode(
  db: Db,
): Promise<ScoreGamemodeId | null> {
  const filter = await readScoresGamemodeFilter(db);
  if (filter.mode === "all") return null;
  if (filter.mode === "auto") return getMostCommonGamemode(db);
  return filter.gamemode;
}

export function resolveScoresGamemodeSync(db: Db): ScoreGamemodeId | null {
  const filter = readScoresGamemodeFilterSync(db);
  if (filter.mode === "all") return null;
  if (filter.mode === "auto") return getMostCommonGamemodeSync(db);
  return filter.gamemode;
}

/** Drizzle condition for a ruleset column, or `undefined` when unfiltered. */
export function scoresGamemodeCondition(
  gamemode: ScoreGamemodeId | null,
  column: typeof scores.rulesetShortName = scores.rulesetShortName,
): SQL | undefined {
  if (gamemode == null) return undefined;
  return eq(column, gamemode);
}

/**
 * Raw SQL fragment + bind params for gamemode filter.
 * @param columnExpr e.g. `s.ruleset_short_name` or `b.ruleset_short_name`
 */
export function scoresGamemodeSql(
  gamemode: ScoreGamemodeId | null,
  columnExpr = "s.ruleset_short_name",
): { sql: string; params: string[] } {
  if (gamemode == null) return { sql: "", params: [] };
  return { sql: ` AND ${columnExpr} = ?`, params: [gamemode] };
}

/** Escape a string for use as a SQLite string literal. */
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Inline SQL fragment (no bind params) — useful when `?` order is awkward
 * across shared FROM clauses. Values are escaped as string literals.
 */
export function scoresGamemodeSqlLiteral(
  gamemode: ScoreGamemodeId | null,
  columnExpr = "s.ruleset_short_name",
): string {
  if (gamemode == null) return "";
  return ` AND lower(COALESCE(${columnExpr}, '')) = ${sqlStringLiteral(gamemode)}`;
}

export function scoresGamemodeCacheKey(
  gamemode: ScoreGamemodeId | null,
): string {
  return gamemode ?? "*";
}

export async function buildScoresGamemodeSettings(db: Db) {
  const [gamemodes, filter, resolvedGamemode] = await Promise.all([
    listScoreGamemodes(db),
    readScoresGamemodeFilter(db),
    resolveScoresGamemode(db),
  ]);

  return {
    mode: filter.mode,
    selectedGamemode: filter.mode === "selected" ? filter.gamemode : null,
    resolvedGamemode,
    mostCommonGamemode: gamemodes.find((g) => g.count > 0)?.id ?? null,
    gamemodes,
  };
}
