import type { AstNode, FieldTerm } from "./ast";
import { LN_DAN_RATIO_THRESHOLD } from "../map-analysis/estDiff";
import { statusNameToInt, type BeatmapStatusName } from "./status";

export type CompiledQuery = {
  /** SQL boolean expression referencing aliases: b, m, ps, rs */
  sql: string;
  params: unknown[];
};

function likePattern(value: string, prefix?: boolean): string {
  const escaped = value.replace(/%/g, "\\%").replace(/_/g, "\\_");
  return prefix ? `${escaped}%` : `%${escaped}%`;
}

/** Positional `?` binders. Alias contract: b=beatmaps, m=mastery, ps=play_stats, rs=retry_stats */
function compileTerm(term: FieldTerm, params: unknown[]): string {
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
    case "mods":
      return `EXISTS (
        SELECT 1 FROM scores s
        WHERE s.beatmap_id = b.id
          AND s.delete_pending = 0
          AND s.mods LIKE ${push(`%${term.value}%`)} ESCAPE '\\'
      )`;
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
    case "dan": {
      // Sunny dan label (est_diff); case-insensitive substring / prefix.
      const pat = push(likePattern(term.value, term.prefix));
      return `(dr.est_diff IS NOT NULL AND lower(dr.est_diff) LIKE lower(${pat}) ESCAPE '\\')`;
    }
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
      const ints = term.values.map((name) =>
        statusNameToInt(name as BeatmapStatusName),
      );
      if (ints.length === 1) {
        return `bs.status = ${push(ints[0]!)}`;
      }
      const placeholders = ints.map((n) => push(n)).join(", ");
      return `bs.status IN (${placeholders})`;
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

export function compileQuery(ast: AstNode): CompiledQuery {
  const params: unknown[] = [];

  function compileNode(node: AstNode): string {
    switch (node.type) {
      case "term":
        return compileTerm(node.term, params);
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
