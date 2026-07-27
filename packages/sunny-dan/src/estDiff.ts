import { DAN_INDEX, type DanInterval } from "./intervals/index.js";

/** LN ratio at/above this uses LN dan; below uses RC/Regular dan. */
export const LN_DAN_RATIO_THRESHOLD = 0.2;

/** LN ratio at/above this is treated as full-LN (FLN) for 7K recommendations. */
export const FLN_RATIO_THRESHOLD = 0.8;

function danTable(lnRatio: number, columnCount: number): DanInterval[] | null {
  const keys = DAN_INDEX[columnCount];
  if (!keys) return null;
  return lnRatio >= LN_DAN_RATIO_THRESHOLD
    ? keys.LN.default
    : keys.RC.default;
}

function intervalLookup(
  sr: number,
  table: DanInterval[],
  fallbackLabel: string,
): string {
  for (const [lower, upper, name] of table) {
    if (lower <= sr && sr <= upper) return name;
  }
  if (sr < table[0]![0]) return `< ${table[0]![2]}`;
  if (sr > table[table.length - 1]![1]) {
    return `> ${table[table.length - 1]![2]}`;
  }
  return fallbackLabel;
}

function findIntervalIndex(sr: number, table: DanInterval[]): number {
  for (let i = 0; i < table.length; i++) {
    const [lower, upper] = table[i]!;
    if (lower <= sr && sr <= upper) return i;
  }
  return -1;
}

/** Sunny ★ interval for a star value on the RC or LN dan table. */
export function danIntervalForStar(
  sr: number,
  lnRatio: number,
  columnCount: number,
): DanInterval | null {
  const table = danTable(lnRatio, columnCount);
  if (!table) return null;
  const idx = findIntervalIndex(sr, table);
  return idx >= 0 ? table[idx]! : null;
}

/** Next dan tier above {@link sr} on the same RC/LN table. */
export function nextDanInterval(
  sr: number,
  lnRatio: number,
  columnCount: number,
): DanInterval | null {
  const table = danTable(lnRatio, columnCount);
  if (!table) return null;
  const idx = findIntervalIndex(sr, table);
  if (idx < 0 || idx >= table.length - 1) return null;
  return table[idx + 1]!;
}

/**
 * Map Sunny rework stars → a single dan label.
 * - LN ratio &lt; 20% → RC / Regular table
 * - LN ratio ≥ 20% → LN table
 */
export function estDiff(
  sr: number,
  lnRatio: number,
  columnCount: number,
): string {
  const table = danTable(lnRatio, columnCount);
  if (!table) return "Unknown difficulty";
  if (lnRatio >= LN_DAN_RATIO_THRESHOLD) {
    return intervalLookup(sr, table, "Unknown LN difficulty");
  }
  return intervalLookup(sr, table, "Unknown RC difficulty");
}
