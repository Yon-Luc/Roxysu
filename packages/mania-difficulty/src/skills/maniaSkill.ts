import type { ManiaDifficultyHitObject } from "../adapters/hitObject";
import { RootFinding } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding";
import {
  ACCURACY_VALUES,
  type AccuracyDifficulties,
  accuracyAtSkill,
} from "./accuracy";
import type { DifficultyProcessor } from "./processors";

const STAR_RATING_ACCURACY = 0.9575;
const NOTE_COUNT_OFFSET = 34.64147;

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

export function createManiaSkill(
  accuracyAt: (current: ManiaDifficultyHitObject) => AccuracyDifficulties,
): ManiaSkillState {
  const accuracyDifficulties: AccuracyDifficulties[] = [];
  let totalNoteWeight = 0;

  function AccuracyAtSkillExact(skill: number): number {
    if (skill === 0) return 0;
    let accuracySum = 0;
    for (const d of accuracyDifficulties) {
      accuracySum += accuracyAtSkill(d, skill);
    }
    const count = accuracyDifficulties.length;
    return accuracySum / (count - Math.min(count * 0.01, 10));
  }

  function DifficultyValueAtAccuracy(accuracy: number): number {
    if (
      accuracyDifficulties.length === 0 ||
      accuracy <= ACCURACY_VALUES[ACCURACY_VALUES.length - 1]!
    ) {
      return 0;
    }
    const rawDifficulty = RootFinding.FindRootExpand(
      (skill) => AccuracyAtSkillExact(skill) - accuracy,
      0,
      10,
    );
    return (
      rawDifficulty *
      (totalNoteWeight / (totalNoteWeight + NOTE_COUNT_OFFSET))
    );
  }

  return {
    process(current) {
      totalNoteWeight += noteWeight(current);
      const d = accuracyAt(current);
      accuracyDifficulties.push(d);
    },
    DifficultyValue: () => DifficultyValueAtAccuracy(STAR_RATING_ACCURACY),
    DifficultyValueAtAccuracy,
    AccuracyAtSkillExact,
  };
}

export function createProcessorSkill(
  processor: DifficultyProcessor,
): ManiaSkillState {
  return createManiaSkill((current) => {
    processor.ProcessStrainFor(current);
    return processor.TransformStrainToAccuracyDifficulties(
      processor.CurrentStrain,
    );
  });
}
