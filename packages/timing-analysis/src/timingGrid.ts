import type { TimingPoint } from "@roxysu/osu-chart";
import type { SnapDivisor } from "./types";

export const SNAP_DIVISORS: SnapDivisor[] = [1, 2, 3, 4, 6, 8, 12, 16];

function bisectRight(times: number[], target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Active uninherited beat length (ms) at a chart time. */
export function getBeatLengthAt(
  timingPoints: TimingPoint[],
  timeMs: number,
): number {
  if (timingPoints.length === 0) return 500;
  const times = timingPoints.map((tp) => tp[0]);
  const idx = bisectRight(times, Math.trunc(timeMs)) - 1;
  const point = timingPoints[Math.max(0, idx)]!;
  return point[1];
}

/** Timing point origin used for snap quantization at `timeMs`. */
export function getTimingOriginAt(
  timingPoints: TimingPoint[],
  timeMs: number,
): { originMs: number; beatLengthMs: number } {
  if (timingPoints.length === 0) return { originMs: 0, beatLengthMs: 500 };
  const times = timingPoints.map((tp) => tp[0]);
  const idx = Math.max(0, bisectRight(times, Math.trunc(timeMs)) - 1);
  const [originMs, beatLengthMs] = timingPoints[idx]!;
  return { originMs, beatLengthMs };
}

export function beatLengthToBpm(beatLengthMs: number): number {
  if (beatLengthMs <= 0) return 0;
  return 60_000 / beatLengthMs;
}

/** Nearest snap grid time for a note at `timeMs`. */
export function quantizeToSnap(
  timeMs: number,
  timingPoints: TimingPoint[],
  divisor: SnapDivisor,
): number {
  const { originMs, beatLengthMs } = getTimingOriginAt(timingPoints, timeMs);
  const snapMs = beatLengthMs / divisor;
  if (snapMs <= 0) return timeMs;
  const n = Math.round((timeMs - originMs) / snapMs);
  return originMs + n * snapMs;
}

export function snapDeviationMs(
  timeMs: number,
  timingPoints: TimingPoint[],
  divisor: SnapDivisor,
): number {
  const snapped = quantizeToSnap(timeMs, timingPoints, divisor);
  return Math.abs(timeMs - snapped);
}

export type SnapFit = {
  divisor: SnapDivisor;
  coverage: number;
  meanDeviationMs: number;
};

/** Pick the snap divisor that best explains note start times. */
export function fitDominantSnap(
  noteTimes: number[],
  timingPoints: TimingPoint[],
  toleranceMs: number,
): SnapFit {
  if (noteTimes.length === 0) {
    return { divisor: 4, coverage: 1, meanDeviationMs: 0 };
  }

  let best: SnapFit = { divisor: 4, coverage: 0, meanDeviationMs: Infinity };

  for (const divisor of SNAP_DIVISORS) {
    let inTolerance = 0;
    let totalDev = 0;
    for (const t of noteTimes) {
      const dev = snapDeviationMs(t, timingPoints, divisor);
      totalDev += dev;
      if (dev <= toleranceMs) inTolerance += 1;
    }
    const coverage = inTolerance / noteTimes.length;
    const meanDeviationMs = totalDev / noteTimes.length;
    if (
      coverage > best.coverage + 0.001 ||
      (Math.abs(coverage - best.coverage) < 0.001 &&
        meanDeviationMs < best.meanDeviationMs)
    ) {
      best = { divisor, coverage, meanDeviationMs };
    }
  }

  return best;
}
