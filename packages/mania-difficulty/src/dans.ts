/**
 * Dan tier tables for the rework star rating.
 *
 * Source of truth is `dans.json` — edit that file to add or retune a dan.
 * This module validates it, expands each tier's floor span into the five
 * bands (low / mid/low / mid / mid/high / high), and looks up labels.
 *
 * Table shape:
 * - `tables["<columnCount>"].rice` — tiers used below the LN ratio threshold.
 * - `tables["<columnCount>"].ln`   — tiers at/above it. Empty array falls back
 *   to the `rice` tiers, so a key count only needs `ln` rows once it diverges.
 * - A tier spans from its `floor` to the next tier's `floor`. Only the last
 *   tier may set an explicit `ceiling`; above it the label is a `>` sentinel.
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
  /** Inclusive lower bound (star rating) of this tier. */
  floor: number;
  /** Inclusive upper bound; only valid on the last tier. */
  ceiling?: number;
};

export type DanTableKind = "rice" | "ln";

export type DanConfig = {
  bands: string[];
  tables: Record<string, Record<DanTableKind, DanTierInput[]>>;
};

/** Expanded tier: `[lower, upper, label]` with `lower` inclusive, `upper` exclusive. */
export type DanInterval = [number, number, string];

const CONFIG = dansJson as DanConfig;

/** Keep generated band boundaries free of float drift in stored labels. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Validate a dan config. Returns a list of human-readable problems; empty
 * means valid. Callers should treat any entry as fatal at boot.
 */
export function validateDanConfig(config: DanConfig = CONFIG): string[] {
  const errors: string[] = [];

  if (!config.bands || config.bands.length === 0) {
    errors.push("bands: must list at least one band name");
  }

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
      tiers.forEach((tier, i) => {
        const at = `tables.${keyCount}.${kind}[${i}]`;
        if (!tier?.name) errors.push(`${at}.name: required`);
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

export const REWORK_DAN_BANDS: readonly string[] = CONFIG.bands;

/** Expand tiers + bands into contiguous `[lower, upper, label]` intervals. */
export function expandDanTiers(
  tiers: readonly DanTierInput[],
  bands: readonly string[] = CONFIG.bands,
): DanInterval[] {
  if (tiers.length === 0 || bands.length === 0) return [];

  const out: DanInterval[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const upper = tiers[i + 1]?.floor ?? tier.ceiling;
    if (upper == null || !Number.isFinite(upper)) continue;

    const span = upper - tier.floor;
    const step = span / bands.length;
    for (let b = 0; b < bands.length; b++) {
      const lower = round6(tier.floor + step * b);
      const isFinalBand = i === tiers.length - 1 && b === bands.length - 1;
      const bandUpper = isFinalBand
        ? upper
        : round6(tier.floor + step * (b + 1));
      out.push([lower, bandUpper, `${tier.name} ${bands[b]}`]);
    }
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

/** Tier names (bands stripped) for a key count — used by UI tier pickers. */
export function reworkDanTierNames(
  columnCount: number,
  kind: DanTableKind = "rice",
): string[] {
  return (reworkDanTiersFor(columnCount, kind) ?? []).map((t) => t.name);
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
 * - Below the first floor → `< {first} {lowest band}`.
 * - Above the last ceiling → `> {last} {highest band}`.
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
    return `${REWORK_UNDER_BAND_PREFIX}${first.name} ${CONFIG.bands[0]}`;
  }

  const hit = reworkDanIntervalForStar(sr, lnRatio, columnCount);
  if (hit) return hit[2];

  const last = tiers[tiers.length - 1]!;
  if (last.ceiling != null && sr > last.ceiling) {
    return `${REWORK_OVER_BAND_PREFIX}${last.name} ${CONFIG.bands[CONFIG.bands.length - 1]}`;
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