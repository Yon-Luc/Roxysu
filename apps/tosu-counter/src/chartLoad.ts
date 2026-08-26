export const EMPTY_CHECKSUM_IDLE_MS = 500;

export type ChartLoadKind = "idle" | "loading" | "ready" | "not-mania" | "error";

export function flagsKey(acronyms: readonly string[]): string {
  return [...acronyms].sort().join(",");
}

function isKeyCount(n: number | null): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= 10;
}

export function keysMismatch(
  keys: number | null,
  columnCount: number | null,
): boolean {
  if (!isKeyCount(keys) || columnCount == null) return false;
  return keys !== columnCount;
}

/**
 * Whether a live frame should (re)fetch `/files/beatmap/file`.
 * Checksum is only committed after a successful parse, so a 4K→7K switch
 * that briefly 404s or still serves the old `.osu` can retry.
 */
export function shouldScheduleChartLoad(args: {
  checksum: string;
  flagsKey: string;
  keys: number | null;
  loadedChecksum: string | null;
  loadedFlags: string | null;
  inFlightChecksum: string | null;
  inFlightFlags: string | null;
  chartKind: ChartLoadKind;
  columnCount: number | null;
}): boolean {
  if (
    args.chartKind === "loading" &&
    args.checksum === args.inFlightChecksum &&
    args.flagsKey === args.inFlightFlags
  ) {
    return false;
  }
  if (args.checksum !== args.loadedChecksum) return true;
  if (args.flagsKey !== args.loadedFlags) return true;
  if (args.chartKind === "error") return true;
  if (args.chartKind === "ready" && keysMismatch(args.keys, args.columnCount)) {
    return true;
  }
  return false;
}

/** Idle only after checksum stays empty — a single blank frame during a map switch is not enough. */
export function emptyChecksumShouldIdle(
  emptySince: number | null,
  now: number,
  holdMs: number = EMPTY_CHECKSUM_IDLE_MS,
): boolean {
  return emptySince != null && now - emptySince >= holdMs;
}
