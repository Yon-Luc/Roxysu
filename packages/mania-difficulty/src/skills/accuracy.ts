/** Port of AccuracyValueMultipliers + AccuracyDifficulties (value semantics). */

export const ACCURACY_VALUES = [
  1.0, 0.995, 0.99, 0.98, 0.95, 0.9, 0.85, 0.8, 0.75,
] as const;

const BASE_DIFFICULTY_INDEX = 3; // 98%

export type AccuracyValueMultipliers = {
  AccuracyMultipliers: number[];
};

export function accuracyValueMultipliers(
  multiplierAtSS: number,
  multiplierAt99_5: number,
  multiplierAt99: number,
  multiplierAt98: number,
  multiplierAt95: number,
  multiplierAt90: number,
  multiplierAt85: number,
  multiplierAt80: number,
): AccuracyValueMultipliers {
  return {
    AccuracyMultipliers: [
      multiplierAtSS,
      multiplierAt99_5,
      multiplierAt99,
      multiplierAt98,
      multiplierAt95,
      multiplierAt90,
      multiplierAt85,
      multiplierAt80,
      0.0,
    ],
  };
}

export type AccuracyDifficulties = {
  BaseDifficulty: number;
  Multipliers: number[];
};

export function accuracyDifficulties(
  difficulty: number,
  multipliers: AccuracyValueMultipliers,
): AccuracyDifficulties {
  return {
    BaseDifficulty: difficulty,
    Multipliers: [...multipliers.AccuracyMultipliers],
  };
}

function getDifficulty(d: AccuracyDifficulties, index: number): number {
  return d.BaseDifficulty * d.Multipliers[index]!;
}

function fromDifficultyArray(difficulties: number[]): AccuracyDifficulties {
  const baseDifficulty = difficulties[BASE_DIFFICULTY_INDEX]!;
  const multipliers = difficulties.map((v) =>
    baseDifficulty !== 0 ? v / baseDifficulty : 0,
  );
  return { BaseDifficulty: baseDifficulty, Multipliers: multipliers };
}

export function accuracyPowInt(
  base: AccuracyDifficulties,
  exponent: number,
): AccuracyDifficulties {
  const n = ACCURACY_VALUES.length;
  const next = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const v = getDifficulty(base, i);
    next[i] = exponent === 2 ? v * v : Math.pow(v, exponent);
  }
  return fromDifficultyArray(next);
}

export function accuracyPow(
  base: AccuracyDifficulties,
  exponent: number,
): AccuracyDifficulties {
  return accuracyPowInt(base, exponent);
}

export function accuracyAdd(
  left: AccuracyDifficulties,
  right: AccuracyDifficulties,
): AccuracyDifficulties {
  const n = ACCURACY_VALUES.length;
  const next = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    next[i] = getDifficulty(left, i) + getDifficulty(right, i);
  }
  return fromDifficultyArray(next);
}

export function accuracyScale(
  left: AccuracyDifficulties,
  right: number,
): AccuracyDifficulties {
  const n = ACCURACY_VALUES.length;
  const next = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    next[i] = getDifficulty(left, i) * right;
  }
  return fromDifficultyArray(next);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function accuracyAtSkill(
  d: AccuracyDifficulties,
  skill: number,
): number {
  if (skill >= getDifficulty(d, 0)) return ACCURACY_VALUES[0]!;
  if (skill <= 0) return ACCURACY_VALUES[ACCURACY_VALUES.length - 1]!;

  for (let i = 1; i < d.Multipliers.length; i++) {
    if (getDifficulty(d, i) > skill) continue;
    const upperSkillBound = getDifficulty(d, i - 1);
    const lowerSkillBound = getDifficulty(d, i);
    const upperAccuracyBound = ACCURACY_VALUES[i - 1]!;
    const lowerAccuracyBound = ACCURACY_VALUES[i]!;
    return lerp(
      lowerAccuracyBound,
      upperAccuracyBound,
      (skill - lowerSkillBound) / (upperSkillBound - lowerSkillBound),
    );
  }
  return 0;
}
