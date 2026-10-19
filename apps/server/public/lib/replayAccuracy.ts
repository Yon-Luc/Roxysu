import type { ReplayJudgmentResult } from "./paintManiaNotefield";

export type ReplayAccuracyJudgment = {
  result: ReplayJudgmentResult;
  accuracyPoints?: number;
  accuracyMax?: number;
};

export type ReplayAccuracyAccum = {
  points: number;
  max: number;
  weighted: number;
  judged: number;
  sliced: boolean;
};

export function emptyReplayAccuracy(): ReplayAccuracyAccum {
  return { points: 0, max: 0, weighted: 0, judged: 0, sliced: false };
}

/**
 * Standard and catch judgments carry an accuracy slice. Mania and taiko
 * fall back to a result weight when the slice is absent.
 */
export function addReplayAccuracy(
  acc: ReplayAccuracyAccum,
  judgment: ReplayAccuracyJudgment,
  weight: Record<ReplayJudgmentResult, number>,
): void {
  if (typeof judgment.accuracyMax === "number") {
    acc.sliced = true;
    acc.points += judgment.accuracyPoints ?? 0;
    acc.max += judgment.accuracyMax;
    return;
  }
  acc.weighted += weight[judgment.result];
  acc.judged += 1;
}

export function replayAccuracy(acc: ReplayAccuracyAccum, scale: number): number {
  if (acc.sliced) return acc.max > 0 ? acc.points / acc.max : 1;
  return acc.judged > 0 ? acc.weighted / (acc.judged * scale) : 1;
}
