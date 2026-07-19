/**
 * Mania hit windows from OD.
 * Keep in sync with `apps/server/src/replay/judge.ts` (covered by server tests).
 */

export type JudgmentResult =
  | "perfect"
  | "great"
  | "good"
  | "ok"
  | "meh"
  | "miss";

export type HitWindows = {
  perfect: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
};

/** Standard (non-convert) mania hit windows from OD. Values are half-widths in ms. */
export function maniaHitWindows(od: number): HitWindows {
  const trunc = (n: number) => Math.trunc(n);
  return {
    perfect: 16,
    great: trunc(64 - 3 * od),
    good: trunc(97 - 3 * od),
    ok: trunc(127 - 3 * od),
    meh: trunc(151 - 3 * od),
    miss: trunc(178 - 3 * od),
  };
}

export function judgeError(
  absError: number,
  windows: HitWindows,
): JudgmentResult {
  const err = Math.round(absError);
  if (err <= windows.perfect) return "perfect";
  if (err <= windows.great) return "great";
  if (err <= windows.good) return "good";
  if (err <= windows.ok) return "ok";
  if (err <= windows.meh) return "meh";
  return "miss";
}

/** Mania accuracy weights — Perfect uses 305 (stable/lazer display). */
export const RESULT_WEIGHT: Record<JudgmentResult, number> = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
};

const ACC_SCALE = 305;

export type JudgmentCounts = Record<JudgmentResult, number>;

export type JudgmentSummary = {
  accuracy: number;
  combo: number;
  maxCombo: number;
  counts: JudgmentCounts;
};

export function emptyJudgmentCounts(): JudgmentCounts {
  return {
    perfect: 0,
    great: 0,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 0,
  };
}

export function accuracyFromCounts(counts: JudgmentCounts): number {
  const totalWeight =
    counts.perfect * RESULT_WEIGHT.perfect +
    counts.great * RESULT_WEIGHT.great +
    counts.good * RESULT_WEIGHT.good +
    counts.ok * RESULT_WEIGHT.ok +
    counts.meh * RESULT_WEIGHT.meh;
  const judged =
    counts.perfect +
    counts.great +
    counts.good +
    counts.ok +
    counts.meh +
    counts.miss;
  return judged > 0 ? totalWeight / (judged * ACC_SCALE) : 1;
}
