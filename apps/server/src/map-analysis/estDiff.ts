import { DAN_INDEX as DAN_INDEX_RAW } from "./intervals/index.js";

type DanInterval = [number, number, string];

type DanIndex = Record<
  number,
  {
    RC: { default: DanInterval[] };
    LN: { default: DanInterval[] };
  }
>;

const DAN_INDEX = DAN_INDEX_RAW as DanIndex;

/** LN ratio at/above this uses LN dan; below uses RC/Regular dan. */
export const LN_DAN_RATIO_THRESHOLD = 0.2;

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
