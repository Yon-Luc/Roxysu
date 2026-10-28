/**
 * Dan tier tables for the rework star rating.
 *
 * Source of truth is `dans.json` — edit that file to add or retune a dan.
 * This module validates it and looks up one label per tier. The `--` / `++`
 * rows are the split; labels do not append low / mid / high.
 *
 * Table shape:
 * - `tables["<columnCount>"].rice` — tiers used below the LN ratio threshold.
 * - `tables["<columnCount>"].ln`   — tiers at/above it. Empty array falls back
 *   to the `rice` tiers, so a key count only needs `ln` rows once it diverges.
 * - A tier spans from its `floor` to the next tier's `floor` and is labelled
 *   with its bare `name`. Only the last tier may set an explicit `ceiling`.
 * - `id` (optional) names the base tier a sub-level belongs to, e.g. the
 *   "Regular 7" / "Regular 7+" / "Regular 7++" rows all carry `id: "Regular 7"`.
 *   It defaults to the tier's own `name`; groups must be contiguous.
 * - `aliases` (optional) are alternate spellings for search. On the base row
 *   of a group they name the whole group ("Gamma" and "Regular Gamma" cover
 *   every `Regular γ` sub-level); on other rows they name just that tier.
 * - A last tier with no `ceiling` is an open-ended sentinel: it covers
 *   [floor, ∞) in one interval labelled with the bare tier name.
 */

import dansJson from "../dans.json";

/** LN ratio at/above which the `ln` tiers are used. Matches Sunny's fixed label threshold. */
export const REWORK_LN_RATIO_THRESHOLD = 0.2;

/** Below the first floor. */
export const REWORK_UNDER_BAND_PREFIX = "< ";
/** Above the last tier's ceiling. */
export const REWORK_OVER_BAND_PREFIX = "> ";
/** No tier table for this key count. */
export const REWORK_UNKNOWN_DAN = "Unknown difficulty";

export type DanTierInput = {
  /** Dan name, e.g. "Alpha" or "LN 13" or "Regular Zenith". */
  name: string;
  /**
   * Base tier this row belongs to, for sub-levels sharing one dan ("Regular 7+"
   * groups under "Regular 7"). Defaults to `name`; must match an earlier
   * tier's name and stay contiguous within its group.
   */
  id?: string;
  /**
   * Alternate spellings for search. On a base row an alias names the whole
   * group; on any other row it names only this tier. Must not shadow a tier
   * name of the same table or a rendered as a "<"/">" sentinel prefix.
   */
  aliases?: string[];
  /** Inclusive lower bound (star rating) of this tier. */
  floor: number;
  /** Inclusive upper bound; only valid on the last tier. */
  ceiling?: number;
};

export type DanTableKind = "rice" | "ln";

export type DanConfig = {
  tables: Record<string, Record<DanTableKind, DanTierInput[]>>;
};

/** Expanded tier: `[lower, upper, label]` with `lower` inclusive, `upper` exclusive. */
export type DanInterval = [number, number, string];

const CONFIG = dansJson as DanConfig;

/**
 * Validate a dan config. Returns a list of human-readable problems; empty
 * means valid. Callers should treat any entry as fatal at boot.
 */
export function validateDanConfig(config: DanConfig = CONFIG): string[] {
  const errors: string[] = [];

  for (const [keyCount, tables] of Object.entries(config.tables ?? {})) {
    if (!/^\d+$/.test(keyCount)) {
      errors.push(`tables.${keyCount}: key count must be numeric`);
    }
    for (const kind of ["rice", "ln"] as const) {
      const tiers = tables?.[kind];
      if (!Array.isArray(tiers)) {
        errors.push(`tables.${keyCount}.${kind}: must be an array`);
        continue;
      }
      if (tiers.length === 0) {
        if (kind === "rice") {
          errors.push(`tables.${keyCount}.rice: must define at least one tier`);
        }
        continue;
      }
      /** Sub-level groups (`id`) must each name a table tier and stay contiguous. */
      const groupLastIndex = new Map<string, number>();
      const tableNames = new Set(
        tiers.map((t) => (typeof t?.name === "string" ? t.name : "")),
      );
      const aliasOwners = new Map<string, string>();
      tiers.forEach((tier, i) => {
        const at = `tables.${keyCount}.${kind}[${i}]`;
        if (!tier?.name) errors.push(`${at}.name: required`);
        if (tier?.id != null) {
          if (typeof tier.id !== "string" || tier.id.trim().length === 0) {
            errors.push(`${at}.id: must be a non-empty string`);
          } else {
            if (!tiers.some((t) => t.name === tier.id)) {
              errors.push(`${at}.id: "${tier.id}" must name a tier of this table`);
            }
            const seenAt = groupLastIndex.get(tier.id);
            if (seenAt != null && seenAt !== i - 1) {
              errors.push(`${at}.id: "${tier.id}" group must be contiguous`);
            }
            groupLastIndex.set(tier.id, i);
          }
        } else if (typeof tier?.name === "string" && groupLastIndex.has(tier.name)) {
          // A plain base row inside an in-flight group keeps it contiguous.
          groupLastIndex.set(tier.name, i);
        }
        if (tier?.aliases != null && !Array.isArray(tier.aliases)) {
          errors.push(`${at}.aliases: must be an array of strings`);
        } else if (Array.isArray(tier?.aliases)) {
          for (const alias of tier.aliases as unknown[]) {
            if (typeof alias !== "string" || alias.trim().length === 0) {
              errors.push(`${at}.aliases: entries must be non-empty strings`);
              continue;
            }
            if (alias.startsWith("<") || alias.startsWith(">")) {
              errors.push(
                `${at}.aliases: "${alias}" must not start with < or > (those are always sentinel lookups)`,
              );
              continue;
            }
            if (tableNames.has(alias)) {
              errors.push(
                `${at}.aliases: "${alias}" must not shadow a tier name of this table`,
              );
              continue;
            }
            const aliasKey = alias.toLowerCase();
            const owner = aliasOwners.get(aliasKey);
            if (owner != null) {
              errors.push(
                `${at}.aliases: "${alias}" is already used for ${owner}`,
              );
              continue;
            }
            aliasOwners.set(aliasKey, tier.name ?? "?");
          }
        }
        if (!Number.isFinite(tier?.floor)) {
          errors.push(`${at}.floor: must be a finite number`);
          return;
        }
        if (i > 0 && tier.floor <= tiers[i - 1]!.floor) {
          errors.push(
            `${at}.floor: must be greater than the previous tier floor (${tiers[i - 1]!.floor})`,
          );
        }
        const isLast = i === tiers.length - 1;
        if (tier.ceiling != null) {
          if (!Number.isFinite(tier.ceiling)) {
            errors.push(`${at}.ceiling: must be a finite number`);
          } else if (tier.ceiling <= tier.floor) {
            errors.push(`${at}.ceiling: must be greater than floor (${tier.floor})`);
          }
        }
        if (!isLast && tier.ceiling != null) {
          errors.push(`${at}.ceiling: only the last tier may set a ceiling`);
        }
      });
    }
  }

  return errors;
}

const VALIDATION_ERRORS = validateDanConfig();
if (VALIDATION_ERRORS.length > 0) {
  throw new Error(
    `Invalid dans.json:\n  ${VALIDATION_ERRORS.join("\n  ")}`,
  );
}

/**
 * Search resolution, built once from the config: canonical tier names and
 * their declared aliases map to the tier names a dan label may start with.
 * - A base row's name resolves to its whole group (every `--` / `++` sub-level);
 *   a normal row's name resolves to itself. An alias on a base row covers
 *   its group; an alias anywhere else covers only that row.
 * - Keys are lowercase and members are MERGED across tables and kinds — a
 *   value can be a tier name in one table and an alias in another (the 4K
 *   row "γ" and the 7K group alias "γ"), because labels spell distinct
 *   names, so OR'd literal patterns never cross tiers.
 */
const MATCH_MEMBERS = new Map<string, string[]>();

for (const tables of Object.values(CONFIG.tables ?? {})) {
  for (const kind of ["rice", "ln"] as const) {
    const tiers = tables?.[kind] ?? [];
    const groupMembers = new Map<string, string[]>();
    for (const tier of tiers) {
      const group = tier.id ?? tier.name;
      if (!group) continue;
      const members = groupMembers.get(group) ?? [];
      if (tier.name) members.push(tier.name);
      groupMembers.set(group, members);
    }
    for (const tier of tiers) {
      if (!tier.name) continue;
      const group = tier.id ?? tier.name;
      const members = group === tier.name
        ? groupMembers.get(group)!
        : [tier.name];
      for (const key of [tier.name, ...(tier.aliases ?? [])]) {
        const slot = MATCH_MEMBERS.get(key.toLowerCase()) ?? [];
        for (const m of members) if (!slot.includes(m)) slot.push(m);
        MATCH_MEMBERS.set(key.toLowerCase(), slot);
      }
    }
  }
}

/**
 * Resolve a search token to the tier names a dan label may start with.
 * `null` when the token resolves nowhere — including explicit "<"/">"
 * sentinel lookups, which always fall back to literal matching.
 */
export function expandReworkDanMatch(value: string): string[] | null {
  const key = value.trim().toLowerCase();
  if (!key || key.startsWith("<") || key.startsWith(">")) return null;
  const members = MATCH_MEMBERS.get(key);
  return members ? members : null;
}

/** Expand tiers into contiguous `[lower, upper, label]` intervals, one per tier. */
export function expandDanTiers(tiers: readonly DanTierInput[]): DanInterval[] {
  if (tiers.length === 0) return [];

  const out: DanInterval[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const upper = tiers[i + 1]?.floor ?? tier.ceiling;
    if (upper == null || !Number.isFinite(upper)) {
      // A final tier without a ceiling is an open-ended sentinel: one
      // unbounded interval labelled with the bare tier name.
      if (i === tiers.length - 1) out.push([tier.floor, Infinity, tier.name]);
      continue;
    }
    out.push([tier.floor, upper, tier.name]);
  }
  return out;
}

/** Resolved tiers for a key count; `ln` falls back to `rice` when empty. */
export function reworkDanTiersFor(
  columnCount: number,
  kind: DanTableKind,
): DanTierInput[] | null {
  const tables = CONFIG.tables[String(Math.round(columnCount))];
  if (!tables) return null;
  const tiers = kind === "ln" ? tables.ln : tables.rice;
  if (tiers && tiers.length > 0) return tiers;
  return tables.rice?.length ? tables.rice : null;
}

/** Which table a map's LN ratio selects. */
export function reworkDanTableKind(
  lnRatio: number,
  columnCount: number,
): DanTableKind | null {
  if (!reworkDanTiersFor(columnCount, "rice")) return null;
  if (!reworkDanTiersFor(columnCount, "ln")) return "rice";
  return lnRatio >= REWORK_LN_RATIO_THRESHOLD ? "ln" : "rice";
}

/** Expanded interval table for a map's key count and LN ratio, or null if unmapped. */
export function reworkDanIntervalTable(
  lnRatio: number,
  columnCount: number,
): DanInterval[] | null {
  const kind = reworkDanTableKind(lnRatio, columnCount);
  if (!kind) return null;
  const tiers = reworkDanTiersFor(columnCount, kind);
  if (!tiers) return null;
  return expandDanTiers(tiers);
}

/** Tier names for a key count — used by UI tier pickers. */
export function reworkDanTierNames(
  columnCount: number,
  kind: DanTableKind = "rice",
): string[] {
  return (reworkDanTiersFor(columnCount, kind) ?? []).map((t) => t.name);
}

/**
 * Unique base-tier ids for a key count (sub-levels like Regular 7+ collapse
 * under `id: "Regular 7"`). Used by marathon / recommend tier pickers.
 */
export function reworkDanBaseTierNames(
  columnCount: number,
  kind: DanTableKind = "rice",
): string[] {
  const tiers = reworkDanTiersFor(columnCount, kind) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    const id = tier.id ?? tier.name;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Query-language fragment matching a rework base tier (`dan:` aliases rework). */
export function reworkDanQueryForTier(tier: string): string {
  const escaped = tier.replace(/"/g, "");
  return `dan:"${escaped}"`;
}

/** Interval containing `sr`, or null when outside the table. */
export function reworkDanIntervalForStar(
  sr: number,
  lnRatio: number,
  columnCount: number,
): DanInterval | null {
  const table = reworkDanIntervalTable(lnRatio, columnCount);
  if (!table) return null;
  for (let i = 0; i < table.length; i++) {
    const [lower, upper, label] = table[i]!;
    const isFinal = i === table.length - 1;
    if (sr >= lower && (isFinal ? sr <= upper : sr < upper)) {
      return table[i]!;
    }
  }
  return null;
}

/**
 * Rework ★ → a single dan label.
 * - LN ratio < 20% → `rice` tiers, else `ln` tiers (empty `ln` falls back to `rice`).
 * - Below the first floor → `< {first}`.
 * - A ceiling-less last tier is an open-ended sentinel: everything at/above
 *   its floor labels with the bare tier name.
 * - Above a declared last ceiling → `> {last}`.
 */
export function reworkDanLabel(
  sr: number,
  lnRatio: number,
  columnCount: number,
): string {
  const kind = reworkDanTableKind(lnRatio, columnCount);
  const tiers = kind ? reworkDanTiersFor(columnCount, kind) : null;
  if (!tiers || tiers.length === 0) return REWORK_UNKNOWN_DAN;

  const first = tiers[0]!;
  if (sr < first.floor) {
    return `${REWORK_UNDER_BAND_PREFIX}${first.name}`;
  }

  const hit = reworkDanIntervalForStar(sr, lnRatio, columnCount);
  if (hit) return hit[2];

  const last = tiers[tiers.length - 1]!;
  if (last.ceiling != null && sr > last.ceiling) {
    return `${REWORK_OVER_BAND_PREFIX}${last.name}`;
  }
  return REWORK_UNKNOWN_DAN;
}

/** Next tier name above `sr` on the same table, for "one dan up" hints. */
export function reworkDanNextTierName(
  sr: number,
  lnRatio: number,
  columnCount: number,
): string | null {
  const kind = reworkDanTableKind(lnRatio, columnCount);
  const tiers = kind ? reworkDanTiersFor(columnCount, kind) : null;
  if (!tiers) return null;
  for (const tier of tiers) {
    if (sr < tier.floor) return tier.name;
  }
  return null;
}