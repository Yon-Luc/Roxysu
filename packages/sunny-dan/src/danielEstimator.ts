import { calculateDaniel } from "./daniel/danielAlgorithm.js";
import { estimateDanielDan } from "./estimateDanielDan";
import { estDiff } from "./estDiff";
import { runSunnyEstimatorFromText } from "./sunnyEstimator";

export type DanielEstimatorResult = {
  star: number;
  lnRatio: number;
  columnCount: number;
  estDiff: string;
  numericDifficulty: number | null;
};

function normalizeReworkResult(result: unknown): {
  star: number;
  lnRatio: number;
  columnCount: number;
} {
  if (typeof result === "number") {
    if (result === -1) throw new Error("Beatmap parse failed");
    if (result === -2) throw new Error("Beatmap mode is not mania");
    if (result === -3) throw new Error("Daniel only supports 4K");
    throw new Error(`Unknown result code: ${result}`);
  }

  let sr: number;
  let lnRatio: number;
  let columnCount: number;

  if (Array.isArray(result)) {
    [sr, lnRatio, columnCount] = result as [number, number, number];
  } else if (result && typeof result === "object") {
    const obj = result as {
      star?: number;
      lnRatio?: number;
      columnCount?: number;
    };
    sr = Number(obj.star);
    lnRatio = Number(obj.lnRatio);
    columnCount = Number(obj.columnCount);
  } else {
    throw new Error("Unexpected calculation result format");
  }

  if (
    !Number.isFinite(sr) ||
    !Number.isFinite(lnRatio) ||
    !Number.isFinite(columnCount)
  ) {
    throw new Error("Invalid estimator output");
  }

  return { star: sr, lnRatio, columnCount };
}

/**
 * Run Daniel on `.osu` text (4K RC-optimized) and map stars → dan label.
 * Non-4K maps fall back to Sunny rework + Sunny dan tables.
 */
export function runDanielEstimatorFromText(
  osuText: string,
  options: {
    speedRate?: number;
    odFlag?: string | number | null;
    cvtFlag?: string | null;
  } = {},
): DanielEstimatorResult {
  const speedRate = options.speedRate ?? 1.0;
  const odFlag = options.odFlag ?? null;

  const danielResult = calculateDaniel(osuText, speedRate, odFlag, {
    withGraph: false,
  });

  if (danielResult === -3) {
    const sunny = runSunnyEstimatorFromText(osuText, {
      speedRate,
      odFlag,
      cvtFlag: options.cvtFlag ?? null,
    });
    return {
      ...sunny,
      numericDifficulty: null,
    };
  }

  const parsed = normalizeReworkResult(danielResult);
  const useDanielDifficulty = parsed.columnCount === 4;
  const danielDifficulty = useDanielDifficulty
    ? estimateDanielDan(parsed.star)
    : null;

  return {
    ...parsed,
    estDiff: useDanielDifficulty
      ? danielDifficulty!.label
      : estDiff(parsed.star, parsed.lnRatio, parsed.columnCount),
    numericDifficulty: useDanielDifficulty
      ? danielDifficulty!.numeric
      : null,
  };
}
