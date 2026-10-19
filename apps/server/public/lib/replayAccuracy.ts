import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import type { TaikoPlayfieldJudgment } from "./paintTaikoPlayfield";

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

/** Rows from any ruleset; only taiko and standard rows carry a `kind`. */
function judgmentKind(j: object): string | undefined {
  return (j as { kind?: string }).kind;
}

/**
 * Taiko replay rows include drumroll ticks and swell hits (`kind` roll or
 * swell). The judge scores accuracy and judgment counts on `hit` rows only
 * (`taikoJudge.ts:simulateTaikoJudgments`), so the rewatch HUD and the video
 * export HUD must skip every other row. A row without `kind` counts as a hit.
 */
export function taikoHudJudgments<T extends object>(
  judgments: readonly T[],
): T[] {
  return judgments.filter((j) => {
    const kind = judgmentKind(j);
    return kind === undefined || kind === "hit";
  });
}

/**
 * Judgment rows that feed the live HUD (combo, accuracy, counters). Only
 * taiko filters; other rulesets count every row.
 */
export function hudJudgments<T extends object>(
  ruleset: string | null | undefined,
  judgments: readonly T[],
): readonly T[] {
  return (ruleset ?? "").toLowerCase() === "taiko"
    ? taikoHudJudgments(judgments)
    : judgments;
}

/**
 * Narrow a rewatch judgment list to the taiko playfield shape. Standard rows
 * use `head | tick | tail` for `kind`; only rows with a taiko `kind` (or none)
 * are kept, so a mismatched ruleset yields an empty list rather than a lie.
 */
export function taikoPlayfieldJudgments(
  judgments: readonly object[],
): TaikoPlayfieldJudgment[] {
  return judgments.filter((j): j is TaikoPlayfieldJudgment => {
    const kind = judgmentKind(j);
    return (
      kind === undefined ||
      kind === "hit" ||
      kind === "roll" ||
      kind === "swell"
    );
  });
}
