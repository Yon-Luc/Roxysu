import { expandReworkDanMatch, isShapeLabel } from "@roxysu/mania-difficulty";
import type { AstNode, FieldTerm } from "./ast";
import {
  DEFAULT_AXIS_THRESHOLDS,
  type AxisThresholds,
} from "../analytics/recommend/axisThresholds";
import {
  isOnlineBeatmapStatus,
  statusNameToInt,
  type BeatmapStatusName,
} from "./status";
import {
  nomodOrMirrorOnlySql,
  scoreRowGradeSql,
} from "./scoreGrade";

export type CompiledQuery = {
  /** SQL boolean expression referencing aliases: b, m, ps, rs */
  sql: string;
  params: unknown[];
};

function likePattern(value: string, prefix?: boolean): string {
  const escaped = value.replace(/%/g, "\\%").replace(/_/g, "\\_");
  return prefix ? `${escaped}%` : `%${escaped}%`;
}

/** User-facing mode tokens that are not the stored ruleset short name. */
const MODE_ALIASES: Record<string, string> = {
  catch: "fruits",
  ctb: "fruits",
};

function normalizeMode(raw: string): string {
  const key = raw.trim().toLowerCase();
  return MODE_ALIASES[key] ?? key;
}

/** Dan tier labels end with a space + digit (e.g. "Regular 1", "LN 10"). */
function isDanTierLabel(value: string): boolean {
  return / \d+$/.test(value);
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Match rework dan labels without crossing tiers — "Regular 1" must not match "Regular 10".
 * Bare names (Alpha, Gamma, …) match as label tokens, not unconstrained substrings, so
 * `dan:Alpha` hits "Alpha" but not the out-of-band sentinel "< Alpha".
 */
function compileDanMatch(
  value: string,
  prefix: boolean | undefined,
  push: (value: unknown) => string,
  estDiffExpr: string,
): string {
  if (prefix && !isDanTierLabel(value)) {
    const pat = push(likePattern(value, true));
    return `(${estDiffExpr} IS NOT NULL AND lower(${estDiffExpr}) LIKE lower(${pat}) ESCAPE '\\')`;
  }

  if (isDanTierLabel(value)) {
    const escaped = escapeLikeLiteral(value);
    const tierSpace = push(`%${escaped} %`);
    const tierExact = push(value);
    return `(${estDiffExpr} IS NOT NULL AND (
      lower(${estDiffExpr}) LIKE lower(${tierSpace}) ESCAPE '\\'
      OR lower(${estDiffExpr}) = lower(${tierExact})
    ))`;
  }

  // Token match: exact, or the tier as a whole word. The prefix clause also
  // covers a leftover "{tier} low" label until relabel.
  const escaped = escapeLikeLiteral(value);
  const exact = push(value);
  const startsBand = push(`${escaped} %`);
  const midToken = push(`% ${escaped} %`);
  const endToken = push(`% ${escaped}`);
  const wantsSentinel = value.startsWith("<") || value.startsWith(">");
  const sentinelClause = wantsSentinel
    ? ""
    : ` AND lower(${estDiffExpr}) NOT LIKE '<%' AND lower(${estDiffExpr}) NOT LIKE '>%'`;
  return `(${estDiffExpr} IS NOT NULL AND (
    lower(${estDiffExpr}) = lower(${exact})
    OR lower(${estDiffExpr}) LIKE lower(${startsBand}) ESCAPE '\\'
    OR lower(${estDiffExpr}) LIKE lower(${midToken}) ESCAPE '\\'
    OR lower(${estDiffExpr}) LIKE lower(${endToken}) ESCAPE '\\'
  )${sentinelClause})`;
}

function compileNumericColumn(
  column: string,
  term: { min?: number; max?: number; op?: string; value?: number },
  push: (value: unknown) => string,
): string {
  if (term.min != null && term.max != null) {
    return `${column} BETWEEN ${push(term.min)} AND ${push(term.max)}`;
  }
  if (term.op != null && term.value != null) {
    return `${column} ${term.op} ${push(term.value)}`;
  }
  return "1=1";
}

/** Positional `?` binders. Alias contract: b=beatmaps, m=mastery (incl. play aggregates), rs=retry_stats */
function compileTerm(
  term: FieldTerm,
  params: unknown[],
  usernames: string[] | null,
  gamemode: string | null,
  thresholds: AxisThresholds,
): string {
  const push = (value: unknown) => {
    params.push(value);
    return "?";
  };

  switch (term.type) {
    case "mode":
      // Bare equality so SQLite can use ruleset indexes (lazer ShortName is lowercase).
      // catch / ctb are aliases for the stored short name fruits.
      return `b.ruleset_short_name = ${push(normalizeMode(String(term.value)))}`;
    case "mapper":
      return `b.mapper_username LIKE ${push(likePattern(term.value))} ESCAPE '\\'`;
    case "title":
      return `b.title LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "artist":
      return `b.artist LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "difficulty":
      return `b.difficulty_name LIKE ${push(likePattern(term.value, term.prefix))} ESCAPE '\\'`;
    case "stars":
      return compileNumericColumn("b.star_rating", term, push);
    case "ar":
      return compileNumericColumn("b.approach_rate", term, push);
    case "cs":
      return compileNumericColumn("b.circle_size", term, push);
    case "od":
      return compileNumericColumn("b.overall_difficulty", term, push);
    case "hp":
      return compileNumericColumn("b.drain_rate", term, push);
    case "key": {
      // Mania key count is stored as circle size; key filters always imply mania.
      const mania = `b.ruleset_short_name = ${push("mania")}`;
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
      const mania = `b.ruleset_short_name = ${push("mania")}`;
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
      const gamemodeClause =
        gamemode != null
          ? `AND s.ruleset_short_name = ${push(gamemode.toLowerCase())}`
          : "";
      return `EXISTS (
        SELECT 1 FROM scores s
        WHERE s.beatmap_id = b.id
          AND s.delete_pending = 0
          ${usernameClause}
          ${gamemodeClause}
          AND s.mods LIKE ${push(likePattern(term.value))} ESCAPE '\\'
      )`;
    }
    case "acc": {
      if (term.min != null && term.max != null) {
        return `m.best_accuracy BETWEEN ${push(term.min / 100)} AND ${push(term.max / 100)}`;
      }
      if (term.op != null && term.value != null) {
        return `m.best_accuracy ${term.op} ${push(term.value / 100)}`;
      }
      return "1=1";
    }
    case "misses": {
      if (term.min != null && term.max != null) {
        return `m.best_misses BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `m.best_misses ${term.op} ${push(term.value)}`;
      }
      return "1=1";
    }
    case "score": {
      if (term.min != null && term.max != null) {
        return `m.best_score BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `m.best_score ${term.op} ${push(term.value)}`;
      }
      return "1=1";
    }
    case "retry":
      return `COALESCE(rs.max_retry, 0) ${term.op} ${push(term.value)}`;
    case "mastery":
      return `COALESCE(m.level, 0) ${term.op} ${push(term.value)}`;
    case "pp":
      return `COALESCE(m.best_pp, 0) ${term.op} ${push(term.value)}`;
    case "played": {
      if ("never" in term && term.never) {
        return `(m.play_count IS NULL OR m.play_count = 0)`;
      }
      if (!("days" in term)) return "1=1";
      const since = Date.now() - term.days * 24 * 60 * 60 * 1000;
      return `(m.last_played_at IS NOT NULL AND m.last_played_at >= ${push(since)})`;
    }
    case "dan":
    case "rework": {
      // Alias/name first: spellings like "Gamma" or "Zeta" resolve to the
      // concrete tier groups of `dans.json`; anything unresolvable keeps the
      // generic label-token matching. `dan:` is an alias of `rework:`.
      const members = expandReworkDanMatch(String(term.value));
      if (members != null) {
        // Labels are the tier name (or a bare sentinel). Exact-or-prefix is
        // tier-safe: "Regular 1" cannot match "Regular 10". The prefix also
        // covers a leftover band suffix until relabel.
        const estDiff = "dr_r.est_diff";
        const clauses = members.map((name) => {
          const exact = push(name);
          const startBand = push(`${name} %`);
          return `(${estDiff} IS NOT NULL AND (
            lower(${estDiff}) = lower(${exact})
            OR lower(${estDiff}) LIKE lower(${startBand}) ESCAPE '\\'
          ))`;
        });
        return clauses.length > 1 ? `( ${clauses.join(" OR ")} )` : clauses[0];
      }
      return compileDanMatch(term.value, term.prefix, push, "dr_r.est_diff");
    }
    case "reworkstars": {
      if (term.min != null && term.max != null) {
        return `dr_r.sunny_star BETWEEN ${push(term.min)} AND ${push(term.max)}`;
      }
      if (term.op != null && term.value != null) {
        return `dr_r.sunny_star ${term.op} ${push(term.value)}`;
      }
      return "dr_r.sunny_star IS NOT NULL";
    }
    case "pattern": {
      const pattern = likePattern(term.value, term.prefix);
      const primaryPat = push(pattern);
      const secondaryPat = push(pattern);
      const [primaryCol, secondaryCol] = isShapeLabel(term.value)
        ? ["pa.shape_pattern", "pa.secondary_shape"]
        : ["pa.dominant_pattern", "pa.secondary_pattern"];
      return `(
        ${primaryCol} IS NOT NULL
        AND (
          lower(${primaryCol}) LIKE lower(${primaryPat}) ESCAPE '\\'
          OR lower(COALESCE(${secondaryCol}, '')) LIKE lower(${secondaryPat}) ESCAPE '\\'
        )
      )`;
    }
    case "axis": {
      if (term.value === "fln") {
        return `(dr_r.ln_ratio IS NOT NULL AND dr_r.ln_ratio >= ${push(thresholds.fln)})`;
      }
      if (term.value === "ln") {
        return `(dr_r.ln_ratio IS NOT NULL AND dr_r.ln_ratio >= ${push(thresholds.ln)} AND dr_r.ln_ratio < ${push(thresholds.fln)})`;
      }
      return `(dr_r.ln_ratio IS NOT NULL AND dr_r.ln_ratio < ${push(thresholds.ln)})`;
    }
    case "grade": {
      const userFilter = (alias: string) => {
        if (usernames != null && usernames.length === 1) {
          return `AND ${alias}.user_username = ${push(usernames[0])}`;
        }
        if (usernames != null && usernames.length > 1) {
          const placeholders = usernames.map((name) => push(name)).join(", ");
          return `AND ${alias}.user_username IN (${placeholders})`;
        }
        return "";
      };
      const modeFilter = (alias: string) =>
        gamemode != null
          ? `AND ${alias}.ruleset_short_name = ${push(gamemode.toLowerCase())}`
          : "";
      const nomod = nomodOrMirrorOnlySql("s");
      const rowGrade = scoreRowGradeSql("s");
      const userClause = userFilter("s");
      const modeClause = modeFilter("s");
      const grade = push(term.value);
      return `EXISTS (
        SELECT 1 FROM scores s
        WHERE s.beatmap_id = b.id
          AND s.delete_pending = 0
          AND s.rank != -1
          ${userClause}
          ${modeClause}
          AND ${nomod}
          AND ${rowGrade} = ${grade}
      )`;
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
      const pat = push(likePattern(term.value));
      const p2 = push(likePattern(term.value));
      const p3 = push(likePattern(term.value));
      const p4 = push(likePattern(term.value));
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
  opts?: {
    username?: string[] | null;
    gamemode?: string | null;
    axisThresholds?: AxisThresholds;
  },
): CompiledQuery {
  const params: unknown[] = [];
  const usernames = opts?.username ?? null;
  const gamemode = opts?.gamemode ?? null;
  const thresholds = opts?.axisThresholds ?? DEFAULT_AXIS_THRESHOLDS;

  function compileNode(node: AstNode): string {
    switch (node.type) {
      case "term":
        return compileTerm(node.term, params, usernames, gamemode, thresholds);
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
