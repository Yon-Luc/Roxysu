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
 * Inlined from `accuracyAtSkill` so the root-finder scan stays a numeric loop.
 * `offset` selects this note's row inside `multipliers` (0 when the skill
 * shares one row).
 */
function accuracyAtSkillInlined(
  base: number,
  multipliers: Float64Array,
  offset: number,
  skill: number,
): number {
  if (skill >= base * multipliers[offset]!) return ACCURACY_VALUES[0]!;
  if (skill <= 0) return LOWEST_ACCURACY;

  for (let i = 1; i < VALUE_COUNT; i++) {
    const lowerSkillBound = base * multipliers[offset + i]!;
    if (lowerSkillBound > skill) continue;
    const upperSkillBound = base * multipliers[offset + i - 1]!;
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
 * Per-note base difficulties live in one growing `Float64Array`. Processor
 * skills share one multiplier row. The Total skill's combined curve changes
 * on every note, so those rows live in a second flat buffer (stride
 * {@link VALUE_COUNT}) — not one `AccuracyDifficulties` object per note.
 */
function createSkillState(
  readNote: (
    current: ManiaDifficultyHitObject,
    push: (base: number, multipliers: readonly number[]) => void,
  ) => void,
  perNoteMultipliers: boolean,
): ManiaSkillState {
  let bases = new Float64Array(INITIAL_CAPACITY);
  let count = 0;
  const sharedMultipliers = new Float64Array(VALUE_COUNT);
  let sharedSet = false;
  let perNote = perNoteMultipliers
    ? new Float64Array(INITIAL_CAPACITY * VALUE_COUNT)
    : sharedMultipliers;
  let totalNoteWeight = 0;

  function ensureCapacity(): void {
    if (count < bases.length) return;
    const next = bases.length * 2;
    const grownBases = new Float64Array(next);
    grownBases.set(bases);
    bases = grownBases;
    if (!perNoteMultipliers) return;
    const grown = new Float64Array(next * VALUE_COUNT);
    grown.set(perNote);
    perNote = grown;
  }

  function pushWithMultipliers(
    base: number,
    values: readonly number[],
  ): void {
    ensureCapacity();
    if (perNoteMultipliers) {
      const offset = count * VALUE_COUNT;
      for (let i = 0; i < VALUE_COUNT; i++) perNote[offset + i] = values[i] ?? 0;
    } else if (!sharedSet) {
      for (let i = 0; i < VALUE_COUNT; i++) {
        sharedMultipliers[i] = values[i] ?? 0;
      }
      sharedSet = true;
    }
    bases[count] = base;
    count += 1;
  }

  function AccuracyAtSkillExact(skill: number): number {
    if (skill === 0) return 0;
    let accuracySum = 0;
    for (let n = 0; n < count; n++) {
      const offset = perNoteMultipliers ? n * VALUE_COUNT : 0;
      accuracySum += accuracyAtSkillInlined(
        bases[n]!,
        perNote,
        offset,
        skill,
      );
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
  }, true);
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
  }, false);
}