import type { AstNode, FieldTerm } from "./ast";
import { LN_DAN_RATIO_THRESHOLD } from "../map-analysis/estDiff";
import {
  isOnlineBeatmapStatus,
  statusNameToInt,
  type BeatmapStatusName,
} from "./status";

export type CompiledQuery = {
  /** SQL boolean expression referencing aliases: b, m, ps, rs */
  sql: string;
  params: unknown[];
};

function likePattern(value: string, prefix?: boolean): string {
  const escaped = value.replace(/%/g, "\\%").replace(/_/g, "\\_");
  return prefix ? `${escaped}%` : `%${escaped}%`;
}

/** Dan tier labels end with a space + digit (e.g. "Regular 1", "LN 10"). */
function isDanTierLabel(value: string): boolean {
  return / \d+$/.test(value);
}

/**
 * Match Sunny dan labels without crossing tiers — "Regular 1" must not match "Regular 10".
 */
function compileDanMatch(
  value: string,
  prefix: boolean | undefined,
  push: (value: unknown) => string,
): string {
  if (prefix && !isDanTierLabel(value)) {
    const pat = push(likePattern(value, true));
    return `(dr.est_diff IS NOT NULL AND lower(dr.est_diff) LIKE lower(${pat}) ESCAPE '\\')`;
  }

  if (isDanTierLabel(value)) {
    const escaped = value.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const tierSpace = push(`%${escaped} %`);
    const tierExact = push(value);
    return `(dr.est_diff IS NOT NULL AND (
      lower(dr.est_diff) LIKE lower(${tierSpace}) ESCAPE '\\'
      OR lower(dr.est_diff) = lower(${tierExact})
    ))`;
  }

  const pat = push(likePattern(value, prefix));
  return `(dr.est_diff IS NOT NULL AND lower(dr.est_diff) LIKE lower(${pat}) ESCAPE '\\')`;
}

/** Positional `?` binders. Alias contract: b=beatmaps, m=mastery, ps=play_stats, rs=retry_stats */
function compileTerm(
  term: FieldTerm,
  params: unknown[],
  usernames: string[] | null,
): string {
  const push = (value: unknown) => {
    params.push(value);
    return "?";
  };

  switch (term.type) {
    case "mode":
      return `lower(b.ruleset_short_name) = lower(${push(term.value)})`;
    case "mapper":
      return `b.mapper_username LIKE ${push(`%${term.value}%`)} ESCAPE '\\'`;
    case "title":
      return `b.title LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "artist":
      return `b.artist LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "difficulty":
      return `b.difficulty_name LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "stars": {
      if (term.min != null && term.max != null) {
        return `b.star_rating BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `b.star_rating ${term.op} ${push(term.value)}`;
      }
      return "1=1";
    }
    case "key": {
      // Mania key count is stored as circle size; key filters always imply mania.
      const mania = `lower(b.ruleset_short_name) = lower(${push("mania")})`;
      if (term.min != null && term.max != null) {
        return `(${mania} AND b.circle_size BETWEEN ${push(term.min)} AND ${push(term.max)})`;
      }
      if (term.op != null && term.value != null) {
        return `(${mania} AND b.circle_size ${term.op} ${push(term.value)})`;
      }
      return mania;
    }
    case "ln": {
      // LN% = end-time objects / total objects * 100 (osu! formula); implies mania.
      const mania = `lower(b.ruleset_short_name) = lower(${push("mania")})`;
      const lnPct = `(b.end_time_object_count * 100.0 / MAX(1, b.total_object_count))`;
      if (term.min != null && term.max != null) {
        return `(${mania} AND ${lnPct} BETWEEN ${push(term.min)} AND ${push(term.max)})`;
      }
      if (term.op != null && term.value != null) {
        return `(${mania} AND ${lnPct} ${term.op} ${push(term.value)})`;
      }
      return mania;
    }
    case "mods": {
      let usernameClause = "";
      if (usernames != null && usernames.length === 1) {
        usernameClause = `AND s.user_username = ${push(usernames[0])}`;
      } else if (usernames != null && usernames.length > 1) {
        const placeholders = usernames.map((name) => push(name)).join(", ");
        usernameClause = `AND s.user_username IN (${placeholders})`;
      }
      return `EXISTS (
        SELECT 1 FROM scores s
        WHERE s.beatmap_id = b.id
          AND s.delete_pending = 0
          ${usernameClause}
          AND s.mods LIKE ${push(`%${term.value}%`)} ESCAPE '\\'
      )`;
    }
    case "acc": {
      if (term.min != null && term.max != null) {
        return `ps.best_accuracy BETWEEN ${push(term.min / 100)} AND ${push(term.max / 100)}`;
      }
      if (term.op != null && term.value != null) {
        return `ps.best_accuracy ${term.op} ${push(term.value / 100)}`;
      }
      return "1=1";
    }
    case "misses": {
      if (term.min != null && term.max != null) {
        return `ps.best_misses BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `ps.best_misses ${term.op} ${push(term.value)}`;
      }
      return "1=1";
    }
    case "score": {
      if (term.min != null && term.max != null) {
        return `ps.best_score BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `ps.best_score ${term.op} ${push(term.value)}`;
      }
      return "1=1";
    }
    case "retry":
      return `COALESCE(rs.max_retry, 0) ${term.op} ${push(term.value)}`;
    case "mastery":
      return `COALESCE(m.level, 0) ${term.op} ${push(term.value)}`;
    case "pp":
      return `COALESCE(ps.best_pp, 0) ${term.op} ${push(term.value)}`;
    case "played": {
      if ("never" in term && term.never) {
        return `(ps.play_count IS NULL OR ps.play_count = 0)`;
      }
      if (!("days" in term)) return "1=1";
      const since = Date.now() - term.days * 24 * 60 * 60 * 1000;
      return `(ps.last_played_at IS NOT NULL AND ps.last_played_at >= ${push(since)})`;
    }
    case "dan":
      return compileDanMatch(term.value, term.prefix, push);
    case "sunny": {
      if (term.min != null && term.max != null) {
        return `dr.sunny_star BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `dr.sunny_star ${term.op} ${push(term.value)}`;
      }
      return "dr.sunny_star IS NOT NULL";
    }
    case "pattern": {
      const pattern = likePattern(term.value, term.prefix);
      const dominantPat = push(pattern);
      const secondaryPat = push(pattern);
      return `(
        pa.dominant_pattern IS NOT NULL
        AND (
          lower(pa.dominant_pattern) LIKE lower(${dominantPat}) ESCAPE '\\'
          OR lower(COALESCE(pa.secondary_pattern, '')) LIKE lower(${secondaryPat}) ESCAPE '\\'
        )
      )`;
    }
    case "axis": {
      if (term.value === "ln") {
        return `(dr.ln_ratio IS NOT NULL AND dr.ln_ratio >= ${push(LN_DAN_RATIO_THRESHOLD)})`;
      }
      return `(dr.ln_ratio IS NOT NULL AND dr.ln_ratio < ${push(LN_DAN_RATIO_THRESHOLD)})`;
    }
    case "status": {
      const names = term.values as BeatmapStatusName[];
      const online = names.filter(isOnlineBeatmapStatus);
      const local = names.filter((n) => !isOnlineBeatmapStatus(n));

      const statusEq = (name: BeatmapStatusName) =>
        `bs.status = ${push(statusNameToInt(name))}`;
      const statusIn = (list: BeatmapStatusName[]) => {
        if (list.length === 1) return statusEq(list[0]!);
        const placeholders = list
          .map((n) => push(statusNameToInt(n)))
          .join(", ");
        return `bs.status IN (${placeholders})`;
      };
      const withOnlineId = (statusSql: string) =>
        `(${statusSql} AND b.online_id > 0)`;

      if (online.length > 0 && local.length === 0) {
        return withOnlineId(statusIn(online));
      }
      if (local.length > 0 && online.length === 0) {
        return statusIn(local);
      }
      return `(${withOnlineId(statusIn(online))} OR (${statusIn(local)}))`;
    }
    case "text": {
      const pat = push(`%${term.value}%`);
      const p2 = push(`%${term.value}%`);
      const p3 = push(`%${term.value}%`);
      const p4 = push(`%${term.value}%`);
      return `(
        b.title LIKE ${pat} ESCAPE '\\'
        OR b.artist LIKE ${p2} ESCAPE '\\'
        OR b.mapper_username LIKE ${p3} ESCAPE '\\'
        OR b.difficulty_name LIKE ${p4} ESCAPE '\\'
      )`;
    }
    default:
      return "1=1";
  }
}

export function compileQuery(
  ast: AstNode,
  opts?: { username?: string[] | null },
): CompiledQuery {
  const params: unknown[] = [];
  const usernames = opts?.username ?? null;

  function compileNode(node: AstNode): string {
    switch (node.type) {
      case "term":
        return compileTerm(node.term, params, usernames);
      case "and":
        return `(${compileNode(node.left)} AND ${compileNode(node.right)})`;
      case "or":
        return `(${compileNode(node.left)} OR ${compileNode(node.right)})`;
      case "not":
        return `(NOT ${compileNode(node.node)})`;
    }
  }

  return { sql: compileNode(ast), params };
}
