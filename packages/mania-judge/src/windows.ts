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

/**
 * Mods that change lazer mania hit windows.
 * Classic without ScoreV2 uses the stable curve. Classic with ScoreV2, and
 * every non-Classic score, uses the default DifficultyRange curve.
 * `convert` only changes the Classic (non-ScoreV2) curve.
 * `rate` is the playback speed (DT/HT); windows scale in map time.
 * EZ/HR adjust overall difficulty before the curve (EZ ×0.5, HR ×1.4, cap 10).
 */
export type ManiaHitWindowOptions = {
  classic?: boolean;
  scoreV2?: boolean;
  convert?: boolean;
  rate?: number;
  easy?: boolean;
  hardRock?: boolean;
};

/** osu! DifficultyRange: min at OD 0, mid at OD 5, max at OD 10. */
function difficultyRange(
  difficulty: number,
  min: number,
  mid: number,
  max: number,
): number {
  if (difficulty > 5) return mid + ((max - mid) * (difficulty - 5)) / 5;
  if (difficulty < 5) return mid + ((mid - min) * (difficulty - 5)) / 5;
  return mid;
}

function adjustedOd(od: number, options: ManiaHitWindowOptions): number {
  let next = od;
  if (options.hardRock) next = Math.min(10, next * 1.4);
  if (options.easy) next = next * 0.5;
  return next;
}

function rateMultiplier(rate: number | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
}

/**
 * Lazer mania hit windows (`ManiaHitWindows.updateWindows`).
 * Half-widths in milliseconds, always `floor(width * rate) + 0.5`.
 */
export function maniaHitWindows(
  od: number,
  options: ManiaHitWindowOptions = {},
): HitWindows {
  const difficulty = adjustedOd(od, options);
  const multiplier = rateMultiplier(options.rate);
  const scale = (width: number) => Math.floor(width * multiplier) + 0.5;
  const classic = Boolean(options.classic) && !options.scoreV2;

  if (classic && options.convert) {
    const rounded = Math.round(difficulty);
    return {
      perfect: scale(16),
      great: scale(rounded > 4 ? 34 : 47),
      good: scale(rounded > 4 ? 67 : 77),
      ok: scale(97),
      meh: scale(121),
      miss: scale(158),
    };
  }

  if (classic) {
    const invertedOd = Math.min(10, Math.max(0, 10 - difficulty));
    return {
      perfect: scale(16),
      great: scale(34 + 3 * invertedOd),
      good: scale(67 + 3 * invertedOd),
      ok: scale(97 + 3 * invertedOd),
      meh: scale(121 + 3 * invertedOd),
      miss: scale(158 + 3 * invertedOd),
    };
  }

  return {
    perfect: scale(difficultyRange(difficulty, 22.4, 19.4, 13.9)),
    great: scale(difficultyRange(difficulty, 64, 49, 34)),
    good: scale(difficultyRange(difficulty, 97, 82, 67)),
    ok: scale(difficultyRange(difficulty, 127, 112, 97)),
    meh: scale(difficultyRange(difficulty, 151, 136, 121)),
    miss: scale(difficultyRange(difficulty, 188, 173, 158)),
  };
}

/** Stable identity for a window set, used to rebuild a live judge. */
export function maniaHitWindowKey(
  od: number,
  options: ManiaHitWindowOptions = {},
): string {
  return [
    od,
    options.classic ? 1 : 0,
    options.scoreV2 ? 1 : 0,
    options.convert ? 1 : 0,
    options.rate ?? 1,
    options.easy ? 1 : 0,
    options.hardRock ? 1 : 0,
  ].join("|");
}

/** Compare a hit error (ms, sign ignored) to lazer half-windows. */
export function judgeError(
  absError: number,
  windows: HitWindows,
): JudgmentResult {
  const err = Math.abs(absError);
  if (!Number.isFinite(err)) return "miss";
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
