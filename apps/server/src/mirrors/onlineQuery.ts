import {
  QueryParseError,
  type AstNode,
  type ComparisonOp,
  type FieldTerm,
} from "../query-language/ast";
import { parseQuery } from "../query-language/parse";
import {
  isOnlineBeatmapStatus,
  type BeatmapStatusName,
} from "../query-language/status";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";

/** Numeric comparison applied after the mirror returns a page of sets. */
export type OnlinePostFilter = {
  field: "keys" | "stars";
  op?: ComparisonOp;
  value?: number;
  min?: number;
  max?: number;
};

export type OnlineMirrorQuery = {
  /** Original QL string (trimmed). */
  rawQuery: string;
  /** Params forwarded to the active mirror search URL. */
  mirrorParams: MirrorSearchParams;
  /** Filters applied on normalized sets (e.g. mania keys via CS). */
  postFilters: OnlinePostFilter[];
};

export class OnlineQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineQueryError";
  }
}

const UNSUPPORTED_FIELDS = new Set([
  "ln",
  "mods",
  "acc",
  "misses",
  "score",
  "retry",
  "mastery",
  "played",
  "pp",
  "dan",
  "daniel",
  "sunny",
  "pattern",
  "axis",
  "grade",
  "difficulty",
]);

const MODE_ALIASES: Record<string, Exclude<MirrorSearchParams["mode"], "any" | undefined>> =
  {
    osu: "osu",
    "osu!": "osu",
    standard: "osu",
    std: "osu",
    o: "osu",
    taiko: "taiko",
    t: "taiko",
    fruits: "fruits",
    catch: "fruits",
    ctb: "fruits",
    c: "fruits",
    f: "fruits",
    mania: "mania",
    m: "mania",
  };

const MIRROR_STATUS: Record<
  string,
  Exclude<MirrorSearchParams["status"], "any" | undefined>
> = {
  pending: "pending",
  ranked: "ranked",
  approved: "ranked", // hinai has no approved filter; treat as ranked
  qualified: "qualified",
  loved: "loved",
  graveyard: "graveyard",
};

function flattenAnd(node: AstNode, out: FieldTerm[]): void {
  if (node.type === "term") {
    out.push(node.term);
    return;
  }
  if (node.type === "and") {
    flattenAnd(node.left, out);
    flattenAnd(node.right, out);
    return;
  }
  if (node.type === "or") {
    throw new OnlineQueryError(
      "Online search only supports AND queries (no OR). Try a simpler filter like key=7 status=r.",
    );
  }
  if (node.type === "not") {
    throw new OnlineQueryError(
      "Online search does not support NOT. Try positive filters only.",
    );
  }
}

function normalizeMode(raw: string): Exclude<MirrorSearchParams["mode"], "any" | undefined> {
  const key = raw.trim().toLowerCase();
  const mode = MODE_ALIASES[key];
  if (!mode) {
    throw new OnlineQueryError(
      `Unknown mode for online search: ${raw} (expected osu, taiko, fruits/catch, or mania)`,
    );
  }
  return mode;
}

function statusToMirror(
  name: BeatmapStatusName,
): Exclude<MirrorSearchParams["status"], "any" | undefined> {
  if (!isOnlineBeatmapStatus(name)) {
    throw new OnlineQueryError(
      `Status "${name}" is local-only and cannot be searched online`,
    );
  }
  const mapped = MIRROR_STATUS[name];
  if (!mapped) {
    throw new OnlineQueryError(`Status "${name}" is not supported for online search`);
  }
  return mapped;
}

/** Widen mirror star bounds (hinai min/max are inclusive); strict ops rely on post-filter. */
function applyStarsToMirrorRange(
  term: {
    min?: number;
    max?: number;
    op?: ComparisonOp;
    value?: number;
  },
  into: { min?: number; max?: number },
): void {
  if (term.min != null && term.max != null) {
    into.min = into.min == null ? term.min : Math.max(into.min, term.min);
    into.max = into.max == null ? term.max : Math.min(into.max, term.max);
    return;
  }
  if (term.op == null || term.value == null) {
    throw new OnlineQueryError("Incomplete stars filter");
  }
  const v = term.value;
  switch (term.op) {
    case "=":
      into.min = into.min == null ? v : Math.max(into.min, v);
      into.max = into.max == null ? v : Math.min(into.max, v);
      break;
    case ">":
    case ">=":
      into.min = into.min == null ? v : Math.max(into.min, v);
      break;
    case "<":
    case "<=":
      into.max = into.max == null ? v : Math.min(into.max, v);
      break;
  }
}

function matchesNumeric(
  value: number,
  filter: OnlinePostFilter,
): boolean {
  if (filter.min != null && filter.max != null) {
    return value >= filter.min && value <= filter.max;
  }
  if (filter.op == null || filter.value == null) return true;
  switch (filter.op) {
    case "=":
      return value === filter.value;
    case ">":
      return value > filter.value;
    case ">=":
      return value >= filter.value;
    case "<":
      return value < filter.value;
    case "<=":
      return value <= filter.value;
    default:
      return true;
  }
}

/** True when any difficulty on the set satisfies every post-filter. */
export function setMatchesOnlinePostFilters(
  set: OnlineBeatmapSet,
  filters: OnlinePostFilter[],
): boolean {
  if (filters.length === 0) return true;
  return set.beatmaps.some((diff) => {
    for (const filter of filters) {
      if (filter.field === "keys") {
        if (diff.keys == null) return false;
        if (!matchesNumeric(diff.keys, filter)) return false;
      } else if (filter.field === "stars") {
        if (!matchesNumeric(diff.stars, filter)) return false;
      }
    }
    return true;
  });
}

/**
 * When post-filters are exactly one equality on mania keys (e.g. key=7),
 * return that key count so callers can hit a keymode-aware hub cache.
 */
export function exactKeymodeFromPostFilters(
  filters: OnlinePostFilter[],
): number | null {
  if (filters.length !== 1) return null;
  const f = filters[0]!;
  if (f.field !== "keys") return null;
  if (f.op === "=" && f.value != null && Number.isSafeInteger(f.value)) {
    return f.value;
  }
  if (
    f.min != null &&
    f.max != null &&
    f.min === f.max &&
    Number.isSafeInteger(f.min)
  ) {
    return f.min;
  }
  return null;
}

/**
 * Hub cache eligibility for Download Maps.
 * Star post-filters are ignored here: they already map to min_stars/max_stars on
 * mirror params (cache identity). Hub stubs have no per-diff stars, so a Hub hit
 * trusts Hinamizawa set-level star bounds from the primed entry.
 *
 * Returns:
 * - `{ keymode: null }` — eligible, no key filter
 * - `{ keymode: N }` — eligible with exact key=N
 * - `null` — not eligible (other post-filters)
 */
export function hubCacheKeymode(
  filters: OnlinePostFilter[],
): { keymode: number | null } | null {
  const nonStar = filters.filter((f) => f.field !== "stars");
  if (nonStar.length === 0) return { keymode: null };
  const keymode = exactKeymodeFromPostFilters(nonStar);
  if (keymode != null) return { keymode };
  return null;
}

export type ParseOnlineMirrorQueryOpts = {
  /** Defaults when the QL omits mode/status/sort. */
  defaultMode?: MirrorSearchParams["mode"];
  defaultStatus?: MirrorSearchParams["status"];
  defaultSort?: MirrorSearchParams["sort"];
};

/**
 * Parse app QL into hinai-friendly mirror params + post-filters.
 * Catalog fields only; score/practice fields throw OnlineQueryError.
 */
export function parseOnlineMirrorQuery(
  raw: string,
  opts: ParseOnlineMirrorQueryOpts = {},
): OnlineMirrorQuery {
  const trimmed = raw.trim();
  const mirrorParams: MirrorSearchParams = {
    mode: opts.defaultMode ?? "mania",
    status: opts.defaultStatus ?? "ranked",
    sort: opts.defaultSort ?? "ranked_desc",
  };
  const postFilters: OnlinePostFilter[] = [];

  if (!trimmed) {
    return { rawQuery: "", mirrorParams, postFilters };
  }

  let ast: AstNode;
  try {
    ast = parseQuery(trimmed);
  } catch (err) {
    if (err instanceof QueryParseError) {
      throw new OnlineQueryError(err.message);
    }
    throw err;
  }

  const terms: FieldTerm[] = [];
  flattenAnd(ast, terms);

  const textParts: string[] = [];
  let creator: string | undefined;
  let modeSet = false;
  let statusSet = false;
  const starRange: { min?: number; max?: number } = {};

  for (const term of terms) {
    if (UNSUPPORTED_FIELDS.has(term.type)) {
      throw new OnlineQueryError(
        `Field "${term.type}" is not supported for online download search. Use status, mode, key/keys, stars, mapper, title, artist, or free text.`,
      );
    }

    switch (term.type) {
      case "mode": {
        const mode = normalizeMode(term.value);
        if (modeSet && mirrorParams.mode !== mode) {
          throw new OnlineQueryError("Online search allows only one mode filter");
        }
        mirrorParams.mode = mode;
        modeSet = true;
        break;
      }
      case "status": {
        if (term.values.length !== 1) {
          throw new OnlineQueryError(
            "Online search supports a single status (e.g. status=r). Multiple statuses are not supported yet.",
          );
        }
        const name = term.values[0] as BeatmapStatusName;
        const status = statusToMirror(name);
        if (statusSet && mirrorParams.status !== status) {
          throw new OnlineQueryError("Online search allows only one status filter");
        }
        mirrorParams.status = status;
        statusSet = true;
        break;
      }
      case "key": {
        mirrorParams.mode = "mania";
        modeSet = true;
        postFilters.push({
          field: "keys",
          op: term.op,
          value: term.value,
          min: term.min,
          max: term.max,
        });
        break;
      }
      case "stars": {
        applyStarsToMirrorRange(term, starRange);
        // Post-filter so a set matches only if a difficulty is in range
        // (hinai star bounds are set-level aggregates).
        postFilters.push({
          field: "stars",
          op: term.op,
          value: term.value,
          min: term.min,
          max: term.max,
        });
        break;
      }
      case "mapper": {
        if (creator != null && creator.toLowerCase() !== term.value.toLowerCase()) {
          throw new OnlineQueryError("Online search allows only one mapper filter");
        }
        creator = term.value;
        break;
      }
      case "title":
      case "artist":
      case "text":
        textParts.push(term.value);
        break;
      default:
        throw new OnlineQueryError(
          `Field "${(term as FieldTerm).type}" is not supported for online download search`,
        );
    }
  }

  if (starRange.min != null && Number.isFinite(starRange.min)) {
    mirrorParams.minStars = starRange.min;
  }
  if (starRange.max != null && Number.isFinite(starRange.max)) {
    mirrorParams.maxStars = starRange.max;
  }
  if (creator) {
    mirrorParams.creator = creator;
  }
  if (textParts.length > 0) {
    mirrorParams.q = textParts.join(" ");
  }

  return { rawQuery: trimmed, mirrorParams, postFilters };
}
