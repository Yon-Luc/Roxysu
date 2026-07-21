import { DAN_INDEX, type DanInterval } from "./intervals/index.js";

/** LN ratio at/above this uses LN dan; below uses RC/Regular dan. */
export const LN_DAN_RATIO_THRESHOLD = 0.2;

/** LN ratio at/above this is treated as full-LN (FLN) for 7K recommendations. */
export const FLN_RATIO_THRESHOLD = 0.8;

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
  const keys = DAN_INDEX[columnCount];
  if (!keys) return "Unknown difficulty";

  if (lnRatio >= LN_DAN_RATIO_THRESHOLD) {
    const lnTable = keys.LN.default;
    return intervalLookup(sr, lnTable, "Unknown LN difficulty");
  }

  const rcTable = keys.RC.default;
  return intervalLookup(sr, rcTable, "Unknown RC difficulty");
}
