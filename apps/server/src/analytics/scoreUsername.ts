import type { Db } from "@roxysu/db/types";
import { scores, settings } from "@roxysu/db/schema";
import {
  SCORES_USERNAME_ALL,
  SCORES_USERNAME_AUTO,
  SCORES_USERNAME_FILTER_KEY,
} from "@roxysu/db/settings-keys";
import { and, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";

export type ScoreUsernameCount = {
  username: string;
  count: number;
};

/** Stored preference: auto, all, or an explicit list of usernames. */
export type ScoresUsernameFilter =
  | { mode: "auto" }
  | { mode: "all" }
  | { mode: "selected"; usernames: string[] };

function uniqueUsernames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Parse the KV string.
 * - missing / "auto" → auto
 * - "*" → all
 * - JSON array → selected usernames
 * - plain string → single selected username (legacy)
 */
export function parseScoresUsernameFilter(
  raw: string | null | undefined,
): ScoresUsernameFilter {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed === SCORES_USERNAME_AUTO) return { mode: "auto" };
  if (trimmed === SCORES_USERNAME_ALL) return { mode: "all" };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const usernames = uniqueUsernames(
          parsed.filter((x): x is string => typeof x === "string"),
        );
        if (usernames.length === 0) return { mode: "auto" };
        return { mode: "selected", usernames };
      }
    } catch {
      // fall through to legacy single-username handling
    }
  }

  return { mode: "selected", usernames: [trimmed] };
}

export function serializeScoresUsernameFilter(
  filter: ScoresUsernameFilter,
): string {
  if (filter.mode === "auto") return SCORES_USERNAME_AUTO;
  if (filter.mode === "all") return SCORES_USERNAME_ALL;
  const usernames = uniqueUsernames(filter.usernames);
  if (usernames.length === 0) return SCORES_USERNAME_AUTO;
  if (usernames.length === 1) return usernames[0]!;
  return JSON.stringify(usernames);
}

/** Normalize PATCH body: "auto" | "*" | username | username[]. */
export function normalizeScoresUsernameFilterInput(
  raw: string | string[],
): ScoresUsernameFilter {
  if (Array.isArray(raw)) {
    const usernames = uniqueUsernames(raw);
    if (usernames.length === 0) return { mode: "auto" };
    return { mode: "selected", usernames };
  }
  return parseScoresUsernameFilter(raw);
}

export async function listScoreUsernames(
  db: Db,
): Promise<ScoreUsernameCount[]> {
  const rows = await db
    .select({
      username: scores.userUsername,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(scores)
    .where(
      and(
        eq(scores.deletePending, false),
        isNotNull(scores.userUsername),
        ne(scores.userUsername, ""),
      ),
    )
    .groupBy(scores.userUsername)
    .orderBy(desc(sql`count(*)`), scores.userUsername);

  return rows
    .filter((r): r is { username: string; count: number } => !!r.username)
    .map((r) => ({ username: r.username, count: r.count }));
}

export function listScoreUsernamesSync(db: Db): ScoreUsernameCount[] {
  const rows = db.$client
    .query(
      `
      SELECT user_username AS username, COUNT(*) AS count
      FROM scores
      WHERE delete_pending = 0
        AND user_username IS NOT NULL
        AND user_username != ''
      GROUP BY user_username
      ORDER BY count DESC, user_username ASC
    `,
    )
    .all() as Array<{ username: string; count: number }>;

  return rows.map((r) => ({
    username: r.username,
    count: Number(r.count),
  }));
}

export async function getMostCommonUsername(db: Db): Promise<string | null> {
  const [top] = await listScoreUsernames(db);
  return top?.username ?? null;
}

export function getMostCommonUsernameSync(db: Db): string | null {
  const [top] = listScoreUsernamesSync(db);
  return top?.username ?? null;
}

export async function readScoresUsernameFilter(
  db: Db,
): Promise<ScoresUsernameFilter> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SCORES_USERNAME_FILTER_KEY))
    .limit(1);
  return parseScoresUsernameFilter(row?.value);
}

export function readScoresUsernameFilterSync(db: Db): ScoresUsernameFilter {
  const row = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(SCORES_USERNAME_FILTER_KEY) as { value: string } | null;
  return parseScoresUsernameFilter(row?.value);
}

/**
 * Resolved usernames to filter on, or `null` when showing all scores.
 * Default ("auto") picks the most common username among non-deleted scores.
 */
export async function resolveScoresUsernames(
  db: Db,
): Promise<string[] | null> {
  const filter = await readScoresUsernameFilter(db);
  if (filter.mode === "all") return null;
  if (filter.mode === "auto") {
    const top = await getMostCommonUsername(db);
    return top ? [top] : null;
  }
  return filter.usernames.length > 0 ? filter.usernames : null;
}

export function resolveScoresUsernamesSync(db: Db): string[] | null {
  const filter = readScoresUsernameFilterSync(db);
  if (filter.mode === "all") return null;
  if (filter.mode === "auto") {
    const top = getMostCommonUsernameSync(db);
    return top ? [top] : null;
  }
  return filter.usernames.length > 0 ? filter.usernames : null;
}

/** Drizzle condition for `scores.userUsername`, or `undefined` when unfiltered. */
export function scoresUsernameCondition(
  usernames: string[] | null,
): SQL | undefined {
  if (usernames == null || usernames.length === 0) return undefined;
  if (usernames.length === 1) return eq(scores.userUsername, usernames[0]!);
  return inArray(scores.userUsername, usernames);
}

/**
 * Raw SQL fragment + bind params for username filter.
 * @param columnExpr e.g. `s.user_username` or `user_username`
 */
export function scoresUsernameSql(
  usernames: string[] | null,
  columnExpr = "s.user_username",
): { sql: string; params: string[] } {
  if (usernames == null || usernames.length === 0) {
    return { sql: "", params: [] };
  }
  if (usernames.length === 1) {
    return { sql: ` AND ${columnExpr} = ?`, params: [usernames[0]!] };
  }
  const placeholders = usernames.map(() => "?").join(", ");
  return {
    sql: ` AND ${columnExpr} IN (${placeholders})`,
    params: [...usernames],
  };
}

/** Escape a string for use as a SQLite string literal. */
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Inline SQL fragment (no bind params) — useful when `?` order is awkward
 * across shared FROM clauses. Usernames are escaped as string literals.
 */
export function scoresUsernameSqlLiteral(
  usernames: string[] | null,
  columnExpr = "s.user_username",
): string {
  if (usernames == null || usernames.length === 0) return "";
  if (usernames.length === 1) {
    return ` AND ${columnExpr} = ${sqlStringLiteral(usernames[0]!)}`;
  }
  const list = usernames.map(sqlStringLiteral).join(", ");
  return ` AND ${columnExpr} IN (${list})`;
}

export function scoresUsernameCacheKey(usernames: string[] | null): string {
  if (usernames == null) return "*";
  return [...usernames].sort().join(",");
}

export async function buildScoresUsernameSettings(db: Db) {
  const [usernames, filter, resolvedUsernames] = await Promise.all([
    listScoreUsernames(db),
    readScoresUsernameFilter(db),
    resolveScoresUsernames(db),
  ]);

  return {
    mode: filter.mode,
    selectedUsernames: filter.mode === "selected" ? filter.usernames : [],
    /** @deprecated Prefer mode + selectedUsernames */
    usernameFilter:
      filter.mode === "auto"
        ? SCORES_USERNAME_AUTO
        : filter.mode === "all"
          ? SCORES_USERNAME_ALL
          : filter.usernames.length === 1
            ? filter.usernames[0]!
            : filter.usernames,
    resolvedUsernames,
    /** @deprecated Prefer resolvedUsernames */
    resolvedUsername: resolvedUsernames?.[0] ?? null,
    mostCommonUsername: usernames[0]?.username ?? null,
    usernames,
  };
}
