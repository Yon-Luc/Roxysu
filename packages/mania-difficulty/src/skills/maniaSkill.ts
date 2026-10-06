import type { ManiaDifficultyHitObject } from "../adapters/hitObject";
import { RootFinding } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding";
import { ACCURACY_VALUES, type AccuracyDifficulties } from "./accuracy";
import type { DifficultyProcessor } from "./processors";

const STAR_RATING_ACCURACY = 0.9575;
const NOTE_COUNT_OFFSET = 34.64147;
const VALUE_COUNT = ACCURACY_VALUES.length;
const LOWEST_ACCURACY = ACCURACY_VALUES[VALUE_COUNT - 1]!;
const INITIAL_CAPACITY = 512;

/**
 * Accuracy at a given skill for one note.
 *
 * Inlined from `accuracyAtSkill` so the root-finder scan stays a numeric loop:
 * multipliers are constant for a skill, so only the base difficulty is read
 * per note.
 */
function accuracyAtSkillInlined(
  base: number,
  multipliers: Float64Array,
  skill: number,
): number {
  if (skill >= base * multipliers[0]!) return ACCURACY_VALUES[0]!;
  if (skill <= 0) return LOWEST_ACCURACY;

  for (let i = 1; i < VALUE_COUNT; i++) {
    const lowerSkillBound = base * multipliers[i]!;
    if (lowerSkillBound > skill) continue;
    const upperSkillBound = base * multipliers[i - 1]!;
    const t = (skill - lowerSkillBound) / (upperSkillBound - lowerSkillBound);
    return (
      ACCURACY_VALUES[i]! +
      (ACCURACY_VALUES[i - 1]! - ACCURACY_VALUES[i]!) * t
    );
  }
  return 0;
}

export type ManiaSkillState = {
  process: (current: ManiaDifficultyHitObject) => void;
  DifficultyValue: () => number;
  DifficultyValueAtAccuracy: (accuracy: number) => number;
  AccuracyAtSkillExact: (skill: number) => number;
};

function noteWeight(current: ManiaDifficultyHitObject): number {
  const max_long_note_weight_duration_ms = 1000.0;
  const long_note_weight_per_200_ms = 0.6;
  let w = 1;
  if (current.IsHoldNote) {
    const duration = Math.min(
      current.EndTime - current.StartTime,
      max_long_note_weight_duration_ms,
    );
    w += (long_note_weight_per_200_ms * duration) / 200.0;
  }
  return w;
}

/**
 * Shared skill state.
 *
 * Per-note base difficulties live in one growing `Float64Array`. Accuracy
 * multipliers are identical for every note of a skill, so they are kept once
 * as a `Float64Array` — previously each note allocated a wrapper object plus an
 * eight-element multiplier array, which dominated the root-finder cost.
 */
function createSkillState(
  readNote: (
    current: ManiaDifficultyHitObject,
    push: (base: number, multipliers: readonly number[]) => void,
  ) => void,
): ManiaSkillState {
  let bases = new Float64Array(INITIAL_CAPACITY);
  let count = 0;
  const multipliers = new Float64Array(VALUE_COUNT);
  let multipliersSet = false;
  let totalNoteWeight = 0;

  function setMultipliers(values: readonly number[]): void {
    for (let i = 0; i < VALUE_COUNT; i++) multipliers[i] = values[i] ?? 0;
    multipliersSet = true;
  }

  function push(base: number): void {
    if (count === bases.length) {
      const grown = new Float64Array(bases.length * 2);
      grown.set(bases);
      bases = grown;
    }
    bases[count] = base;
    count += 1;
  }

  function pushWithMultipliers(
    base: number,
    values: readonly number[],
  ): void {
    if (!multipliersSet) setMultipliers(values);
    push(base);
  }

  function AccuracyAtSkillExact(skill: number): number {
    if (skill === 0) return 0;
    let accuracySum = 0;
    for (let n = 0; n < count; n++) {
      accuracySum += accuracyAtSkillInlined(bases[n]!, multipliers, skill);
    }
    return accuracySum / (count - Math.min(count * 0.01, 10));
  }

  function DifficultyValueAtAccuracy(accuracy: number): number {
    if (count === 0 || accuracy <= LOWEST_ACCURACY) return 0;
    const rawDifficulty = RootFinding.FindRootExpand(
      (skill) => AccuracyAtSkillExact(skill) - accuracy,
      0,
      10,
    );
    return (
      rawDifficulty * (totalNoteWeight / (totalNoteWeight + NOTE_COUNT_OFFSET))
    );
  }

  return {
    process(current) {
      totalNoteWeight += noteWeight(current);
      readNote(current, pushWithMultipliers);
    },
    DifficultyValue: () => DifficultyValueAtAccuracy(STAR_RATING_ACCURACY),
    DifficultyValueAtAccuracy,
    AccuracyAtSkillExact,
  };
}

/** Skill backed by combined `AccuracyDifficulties` (the Total skill). */
export function createManiaSkill(
  accuracyAt: (current: ManiaDifficultyHitObject) => AccuracyDifficulties,
): ManiaSkillState {
  return createSkillState((current, push) => {
    const d = accuracyAt(current);
    push(d.BaseDifficulty, d.Multipliers);
  });
}

/**
 * Skill backed by a difficulty processor.
 *
 * The processor's multipliers are fixed, so they are captured once and the raw
 * strain is pushed per note instead of building a wrapper object.
 */
export function createProcessorSkill(
  processor: DifficultyProcessor,
): ManiaSkillState {
  return createSkillState((current, push) => {
    processor.ProcessStrainFor(current);
    push(processor.CurrentStrain, processor.accuracyMultipliers);
  });
}