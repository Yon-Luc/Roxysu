/** Port of AccuracyValueMultipliers + AccuracyDifficulties (value semantics). */

import { DiffUtils } from "../../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

export const ACCURACY_VALUES = [
  1.0, 0.995, 0.99, 0.98, 0.95, 0.9, 0.85, 0.8, 0.75,
] as const;

export type AccuracyValueMultipliers = {
  AccuracyMultipliers: number[];
};

/**
 * SS (index 0) is always 1: the raw strain is the difficulty of a 100% hit.
 * The last slot is the floor accuracy, which asks for no skill.
 */
export function accuracyValueMultipliers(
  multiplierAt995: number,
  multiplierAt99: number,
  multiplierAt98: number,
  multiplierAt95: number,
  multiplierAt90: number,
  multiplierAt85: number,
  multiplierAt80: number,
): AccuracyValueMultipliers {
  return {
    AccuracyMultipliers: [
      1.0,
      multiplierAt995,
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
  baseDifficulty: number,
  multipliers: AccuracyValueMultipliers,
): AccuracyDifficulties {
  return {
    BaseDifficulty: baseDifficulty,
    Multipliers: [...multipliers.AccuracyMultipliers],
  };
}

/** Index 0 is the base (SS). Every other index is relative to it. */
function getDifficulty(d: AccuracyDifficulties, index: number): number {
  return index === 0
    ? d.BaseDifficulty
    : d.BaseDifficulty * d.Multipliers[index]!;
}

/** Integer overload of DiffUtils.Pow, used by AccuracyDifficulties.Pow(int). */
function powInt(x: number, exponent: number): number {
  switch (exponent) {
    case 0:
      return 1;
    case 1:
      return x;
    case 2:
      return x * x;
    case 3:
      return x * x * x;
    case 4:
      return x * x * x * x;
    case 5:
      return x * x * x * x * x;
    default:
      return DiffUtils.Pow(x, exponent);
  }
}

export function accuracyPowInt(
  base: AccuracyDifficulties,
  exponent: number,
): AccuracyDifficulties {
  const multipliers = base.Multipliers.map((m) => powInt(m, exponent));
  return {
    BaseDifficulty: powInt(base.BaseDifficulty, exponent),
    Multipliers: multipliers,
  };
}

export function accuracyPow(
  base: AccuracyDifficulties,
  exponent: number,
): AccuracyDifficulties {
  return {
    BaseDifficulty: Math.pow(base.BaseDifficulty, exponent),
    Multipliers: base.Multipliers.map((m) => Math.pow(m, exponent)),
  };
}

export function accuracyAdd(
  left: AccuracyDifficulties,
  right: AccuracyDifficulties,
): AccuracyDifficulties {
  const newBase = left.BaseDifficulty + right.BaseDifficulty;
  const multipliers = new Array<number>(left.Multipliers.length).fill(0);
  for (let i = 0; i < left.Multipliers.length - 1; i++) {
    multipliers[i] =
      newBase > 0
        ? (getDifficulty(left, i) + getDifficulty(right, i)) / newBase
        : 1;
  }
  return { BaseDifficulty: newBase, Multipliers: multipliers };
}

export function accuracyScale(
  left: AccuracyDifficulties,
  right: number,
): AccuracyDifficulties {
  return {
    BaseDifficulty: left.BaseDifficulty * right,
    Multipliers: left.Multipliers,
  };
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
