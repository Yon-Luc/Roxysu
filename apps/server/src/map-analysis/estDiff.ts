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
 * Map Sunny rework stars → dan label using osumania_map_analyser interval tables.
 * Mix maps (LN ratio ≥ 0.15) get `RC || LN`.
 */
export function estDiff(
  sr: number,
  lnRatio: number,
  columnCount: number,
): string {
  const keys = DAN_INDEX[columnCount];
  if (!keys) return "Unknown difficulty";

  const rcTable = keys.RC.default;
  const rcDiff = intervalLookup(sr, rcTable, "Unknown RC difficulty");
  if (lnRatio < 0.15) return rcDiff;

  const lnTable = keys.LN.default;
  const lnDiff = intervalLookup(sr, lnTable, "Unknown LN difficulty");
  return `${rcDiff} || ${lnDiff}`;
}
