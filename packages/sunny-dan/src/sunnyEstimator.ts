import { calculate } from "./sunny/sunnyAlgorithm.js";
import { estDiff } from "./estDiff";

export type SunnyEstimatorResult = {
  star: number;
  lnRatio: number;
  columnCount: number;
  estDiff: string;
};

function normalizeReworkResult(
  result: unknown,
): Omit<SunnyEstimatorResult, "estDiff"> {
  if (typeof result === "number") {
    if (result === -1) throw new Error("Beatmap parse failed");
    if (result === -2) throw new Error("Beatmap mode is not mania");
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

/** Run Sunny Rework on `.osu` text and map stars → dan label. */
export function runSunnyEstimatorFromText(
  osuText: string,
  options: {
    speedRate?: number;
    odFlag?: string | number | null;
    cvtFlag?: string | null;
  } = {},
): SunnyEstimatorResult {
  const speedRate = options.speedRate ?? 1.0;
  const odFlag = options.odFlag ?? null;
  const cvtFlag = options.cvtFlag ?? null;

  const rawResult = calculate(osuText, speedRate, odFlag, cvtFlag, {
    withGraph: false,
  });
  const parsed = normalizeReworkResult(rawResult);

  return {
    ...parsed,
    estDiff: estDiff(parsed.star, parsed.lnRatio, parsed.columnCount),
  };
}
