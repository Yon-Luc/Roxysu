import type { ManiaBeatmapInput } from "../types";
import type { ManiaDifficultyAttributes } from "../types";
import { buildHitObjectGraph, meanManipulation } from "../adapters/hitObject";
import { DiffUtils } from "../../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import {
  createCoordinationProcessor,
  createJackProcessor,
  createReleaseProcessor,
  createSpeedProcessor,
  createTechnicalProcessor,
} from "./processors";
import { createManiaSkill, createProcessorSkill } from "./maniaSkill";
import {
  accuracyAdd,
  accuracyPow,
  accuracyScale,
} from "./accuracy";

const OVERALL_MULTIPLIER = 0.360643;
const STAR_RATING_EXPONENT = 0.52899;
const OD_WEIGHT = 0.188;
const RELEASE_WEIGHT = 0.72;
const COMBINE_LAMBDA = 2;

function scaleToStarRating(aggregatedDifficulty: number): number {
  if (aggregatedDifficulty <= 0) return 0;
  return OVERALL_MULTIPLIER * DiffUtils.Pow(aggregatedDifficulty, STAR_RATING_EXPONENT);
}

/** Lazer mania great window half-width (DifficultyRange 64/49/34). */
export function greatHitWindowForOd(od: number): number {
  const min = 64;
  const mid = 49;
  const max = 34;
  if (od <= 5) return min + ((mid - min) * od) / 5;
  return mid + ((max - mid) * (od - 5)) / 5;
}

function hitLeniency(greatHitWindow: number): number {
  return 0.6 * (greatHitWindow - 90) + 90;
}

function hitWindowMultiplier(greatHitWindow: number): number {
  const od8_great_window = 40.0;
  const raw = hitLeniency(od8_great_window) / hitLeniency(greatHitWindow);
  return 1.0 + OD_WEIGHT * (raw - 1.0);
}

function participationRatio(...difficulties: number[]): number {
  let sum = 0;
  let sumSquares = 0;
  for (const d of difficulties) {
    sum += d;
    sumSquares += d * d;
  }
  return sumSquares > 0 ? (sum * sum) / sumSquares : 1.0;
}

/**
 * Full-ish mania difficulty calculation matching CreateDifficultyAttributes flow:
 * processors → skills → Total accuracy curve → star rating.
 * Does not yet include pattern-preprocessor manipulation/endurance factors.
 */
export function calculateWithSkills(
  beatmap: ManiaBeatmapInput,
  options?: { clockRate?: number },
): ManiaDifficultyAttributes {
  const clockRate = options?.clockRate ?? 1;
  const objects = buildHitObjectGraph(
    beatmap.columnCount,
    beatmap.notes,
    clockRate,
  );

  if (objects.length === 0) {
    return {
      starRating: 0,
      noteCount: 0,
      holdNoteCount: 0,
      overallDifficulty: beatmap.overallDifficulty,
      lnRatio: 0,
    };
  }

  const speedProc = createSpeedProcessor();
  const techProc = createTechnicalProcessor();
  const jackProc = createJackProcessor();
  const coordProc = createCoordinationProcessor();
  const releaseProc = createReleaseProcessor();

  const speedSkill = createProcessorSkill(speedProc);
  const techSkill = createProcessorSkill(techProc);
  const jackSkill = createProcessorSkill(jackProc);
  const coordSkill = createProcessorSkill(coordProc);
  const releaseSkill = createProcessorSkill(releaseProc);

  // Total reads processors after individual skills have advanced them —
  // matching C#: each skill Process calls its processor; Total then reads CurrentStrain.
  // Order in calculator: Process each object through all skills (each advances its processor).
  // Total.AccuracyDifficultiesAt only reads CurrentStrain without re-processing evaluators...
  // Looking at Total — it only TransformStrainToAccuracyDifficulties(CurrentStrain), it does NOT
  // call ProcessStrainFor. So Total must run AFTER other skills have processed the same object.
  // Skill order in CreateSkills: Speed, Technical, Jack, Coordination, Release, Total, Total(no releases?)
  // And DifficultyCalculator processes each hit object through ALL skills in order.
  // So for each object: Speed processes (advances speed), Tech..., then Total reads all strains.

  const totalSkill = createManiaSkill((current) => {
    // Processors already advanced by individual skills for this note.
    // Wait — if we call totalSkill.process after individual skills.process, strains are current.
    // But createManiaSkill only calls accuracyAt once per process.
    const coordinationDifficulty =
      coordProc.TransformStrainToAccuracyDifficulties(coordProc.CurrentStrain);
    const releaseDifficulty =
      releaseProc.TransformStrainToAccuracyDifficulties(releaseProc.CurrentStrain);
    const speedDifficulty =
      speedProc.TransformStrainToAccuracyDifficulties(speedProc.CurrentStrain);
    const jackDifficulty =
      jackProc.TransformStrainToAccuracyDifficulties(jackProc.CurrentStrain);
    const technicalDifficulty =
      techProc.TransformStrainToAccuracyDifficulties(techProc.CurrentStrain);

    const powerSum = accuracyAdd(
      accuracyAdd(
        accuracyAdd(
          accuracyPow(speedDifficulty, COMBINE_LAMBDA),
          accuracyPow(jackDifficulty, COMBINE_LAMBDA),
        ),
        accuracyPow(coordinationDifficulty, COMBINE_LAMBDA),
      ),
      accuracyPow(technicalDifficulty, COMBINE_LAMBDA),
    );

    const tapDifficulty =
      powerSum.BaseDifficulty > 0
        ? accuracyPow(powerSum, 1.0 / COMBINE_LAMBDA)
        : powerSum;

    return accuracyAdd(
      tapDifficulty,
      accuracyScale(releaseDifficulty, RELEASE_WEIGHT),
    );
  });

  for (const obj of objects) {
    speedSkill.process(obj);
    techSkill.process(obj);
    jackSkill.process(obj);
    coordSkill.process(obj);
    releaseSkill.process(obj);
    totalSkill.process(obj);
  }

  const greatHitWindow = greatHitWindowForOd(beatmap.overallDifficulty);
  const odMult = hitWindowMultiplier(greatHitWindow);
  const lengthBonus = 1;
  const consistencyMult = 1;

  const speedStarRating =
    scaleToStarRating(speedSkill.DifficultyValue()) * odMult;
  const technicalStarRating =
    scaleToStarRating(techSkill.DifficultyValue()) * odMult;
  const jackStarRating =
    scaleToStarRating(jackSkill.DifficultyValue()) * odMult;
  const coordinationStarRating =
    scaleToStarRating(coordSkill.DifficultyValue()) * odMult;
  const releaseStarRating =
    scaleToStarRating(releaseSkill.DifficultyValue()) * odMult;

  const starRating =
    scaleToStarRating(totalSkill.DifficultyValue() * consistencyMult) *
    odMult *
    lengthBonus;

  const ssSkill = totalSkill.DifficultyValueAtAccuracy(1.0);
  const starRatingSs =
    scaleToStarRating(ssSkill * consistencyMult) * odMult * lengthBonus;

  const holdNoteCount = beatmap.notes.filter((n) => n.endMs > n.startMs).length;
  // Attributes use full beatmap note counts (C# CreateDifficultyAttributes),
  // while skills only process difficulty objects (N-1).
  const totalNotes = beatmap.notes.length;

  return {
    starRating,
    starRatingSs,
    speedDifficulty: speedStarRating,
    technicalDifficulty: technicalStarRating,
    jackDifficulty: jackStarRating,
    coordinationDifficulty: coordinationStarRating,
    releaseDifficulty: releaseStarRating,
    variety: participationRatio(
      speedStarRating,
      technicalStarRating,
      jackStarRating,
      coordinationStarRating,
      releaseStarRating,
    ),
    lnRatio: totalNotes > 0 ? holdNoteCount / totalNotes : 0,
    greatHitWindow,
    meanManipulation: meanManipulation(objects),
    noteCount: totalNotes,
    holdNoteCount,
    overallDifficulty: beatmap.overallDifficulty,
  };
}
