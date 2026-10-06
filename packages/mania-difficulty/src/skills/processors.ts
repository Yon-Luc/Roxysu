import type { ManiaDifficultyHitObject } from "../adapters/hitObject";
import { DiffUtils } from "../../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { SpeedEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator";
import { TechnicalEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator";
import { JackEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator";
import { CoordinationEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator";
import { ReleaseEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator";
import { ChordUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils";
import {
  type AccuracyDifficulties,
  accuracyDifficulties,
  accuracyValueMultipliers,
} from "./accuracy";

export type DifficultyProcessor = {
  CurrentStrain: number;
  /** Accuracy multipliers for this skill; fixed for every note. */
  accuracyMultipliers: readonly number[];
  ProcessStrainFor: (current: ManiaDifficultyHitObject) => void;
  TransformStrainToAccuracyDifficulties: (
    strain: number,
  ) => AccuracyDifficulties;
};

export function createSpeedProcessor(): DifficultyProcessor {
  const multipliers = accuracyValueMultipliers(
    1.2, 1.125, 1.05, 1.0, 0.84, 0.65, 0.4, 0.1,
  );
  const strain_decay_base = 0.05007;
  let CurrentStrain = 0;
  return {
    get CurrentStrain() {
      return CurrentStrain;
    },
    accuracyMultipliers: multipliers.AccuracyMultipliers,
    ProcessStrainFor(current) {
      CurrentStrain *= DiffUtils.Pow(strain_decay_base, current.DeltaTime / 1000);
      CurrentStrain += SpeedEvaluator.EvaluateDifficultyOf(current);
    },
    TransformStrainToAccuracyDifficulties(strain) {
      return accuracyDifficulties(strain, multipliers);
    },
  };
}

export function createJackProcessor(): DifficultyProcessor {
  const multipliers = accuracyValueMultipliers(
    1.01, 1.0075, 1.005, 1.0, 0.97, 0.84, 0.6, 0.28,
  );
  const strain_decay_base = 0.50497;
  let CurrentStrain = 0;
  return {
    get CurrentStrain() {
      return CurrentStrain;
    },
    accuracyMultipliers: multipliers.AccuracyMultipliers,
    ProcessStrainFor(current) {
      CurrentStrain *= Math.pow(strain_decay_base, current.DeltaTime / 1000);
      CurrentStrain += JackEvaluator.EvaluateDifficultyOf(current);
    },
    TransformStrainToAccuracyDifficulties(strain) {
      return accuracyDifficulties(strain, multipliers);
    },
  };
}

export function createCoordinationProcessor(): DifficultyProcessor {
  const multipliers = accuracyValueMultipliers(
    1.22, 1.15, 1.1, 1.0, 0.94, 0.83, 0.72, 0.32,
  );
  const strain_decay_base = 0.52909;
  let CurrentStrain = 0;
  return {
    get CurrentStrain() {
      return CurrentStrain;
    },
    accuracyMultipliers: multipliers.AccuracyMultipliers,
    ProcessStrainFor(current) {
      CurrentStrain *= Math.pow(strain_decay_base, current.DeltaTime / 1000);
      CurrentStrain += CoordinationEvaluator.EvaluateDifficultyOf(current);
    },
    TransformStrainToAccuracyDifficulties(strain) {
      return accuracyDifficulties(strain, multipliers);
    },
  };
}

export function createReleaseProcessor(): DifficultyProcessor {
  const multipliers = accuracyValueMultipliers(
    1.55, 1.31, 1.2, 1.0, 0.91, 0.7, 0.45, 0.2,
  );
  const strain_decay_base = 0.89647;
  let CurrentStrain = 0;
  return {
    get CurrentStrain() {
      return CurrentStrain;
    },
    accuracyMultipliers: multipliers.AccuracyMultipliers,
    ProcessStrainFor(current) {
      CurrentStrain *= DiffUtils.Pow(strain_decay_base, current.DeltaTime / 1000);
      CurrentStrain += ReleaseEvaluator.EvaluateDifficultyOf(current);
    },
    TransformStrainToAccuracyDifficulties(strain) {
      return accuracyDifficulties(strain, multipliers);
    },
  };
}

export function createTechnicalProcessor(): DifficultyProcessor {
  const multipliers = accuracyValueMultipliers(
    1.46, 1.38, 1.25, 1.1, 0.88, 0.7, 0.55, 0.25,
  );
  const strain_decay_base = 0.06696;
  const rhythm_window = 10;
  const variety_window = 8;
  let CurrentStrain = 0;
  const recentIrregularities: number[] = [];
  let irregularitySum = 0;
  const recentShapes: Array<{ rhythmClass: number; direction: number }> = [];
  let previousDeltaTime = -1.0;

  function windowedIrregularity(rhythmIrregularity: number): number {
    recentIrregularities.push(rhythmIrregularity);
    irregularitySum += rhythmIrregularity;
    while (recentIrregularities.length > rhythm_window) {
      irregularitySum -= recentIrregularities.shift()!;
    }
    return irregularitySum / recentIrregularities.length;
  }

  function distinctShapeCount(): number {
    let distinct = 0;
    for (let i = 0; i < recentShapes.length; i++) {
      let seen = false;
      for (let j = 0; j < i; j++) {
        if (
          recentShapes[j]!.rhythmClass === recentShapes[i]!.rhythmClass &&
          recentShapes[j]!.direction === recentShapes[i]!.direction
        ) {
          seen = true;
          break;
        }
      }
      if (!seen) distinct++;
    }
    return distinct;
  }

  function patternVariety(hitObject: ManiaDifficultyHitObject): number {
    recentShapes.push(TechnicalEvaluator.EvaluateShapeOf(hitObject));
    while (recentShapes.length > variety_window) recentShapes.shift();
    return TechnicalEvaluator.EvaluatePatternVarietyOf(
      distinctShapeCount(),
      hitObject.Row.TotalColumns,
    );
  }

  return {
    get CurrentStrain() {
      return CurrentStrain;
    },
    accuracyMultipliers: multipliers.AccuracyMultipliers,
    ProcessStrainFor(current) {
      CurrentStrain *= DiffUtils.Pow(strain_decay_base, current.DeltaTime / 1000);
      if (current.DeltaTime < ChordUtils.CHORD_TOLERANCE_MS) return;

      const rhythmIrregularity = TechnicalEvaluator.EvaluateRhythmIrregularityOf(
        current,
        previousDeltaTime,
      );
      previousDeltaTime = current.DeltaTime;
      CurrentStrain += TechnicalEvaluator.EvaluateDifficultyOf(
        current,
        rhythmIrregularity,
        patternVariety(current),
        windowedIrregularity(rhythmIrregularity),
      );
    },
    TransformStrainToAccuracyDifficulties(strain) {
      return accuracyDifficulties(strain, multipliers);
    },
  };
}
