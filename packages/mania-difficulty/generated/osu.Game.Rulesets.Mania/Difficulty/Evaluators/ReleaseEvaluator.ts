// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator.cs
// upstream sha: bd6bbda8e649a806371d784a485d5962f709089e
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const max_long_note_duration_ms = 1000.0;

/** Generated from C# class ReleaseEvaluator */
export const ReleaseEvaluator = {
  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    const release_weight = 0.9;
    let releaseDifficulty = 0.0;
    if (!(!!(current).IsHoldNote)) {
      return releaseDifficulty;
    }
    const total_weight = 2.83449;
    let duration = Math.min((current.EndTime - current.StartTime), max_long_note_duration_ms);
    let longNoteGate = ReleaseEvaluator.longNoteGateOf(duration);
    releaseDifficulty += ReleaseEvaluator.calculateLongHoldBonus(duration, longNoteGate);
    releaseDifficulty += ReleaseEvaluator.calculateReleaseSpeedBonus(current, longNoteGate);
    releaseDifficulty += ReleaseEvaluator.calculateReleaseWhileHolds(current, longNoteGate);
    return ((releaseDifficulty * release_weight) * total_weight);
  },

  longNoteGateOf(duration: number): number {
    return DiffUtils.Logistic(duration, 110.90068, 0.07);
  },

  calculateLongHoldBonus(duration: number, longNoteGate: number): number {
    let seconds = (duration / 1000.0);
    let holdLengthFactor = ((1.4 * DiffUtils.Smoothstep(duration, 500, 680)) * seconds);
    return (Math.min((((0.42 + (0.75 * seconds)) + holdLengthFactor)), 1.0) * longNoteGate);
  },

  calculateReleaseSpeedBonus(current: ManiaDifficultyHitObject, longNoteGate: number): number {
    const slope = 0.1;
    const offset_ms = 30.0;
    const weight = 0.2;
    let closestReleaseDelta = Number.POSITIVE_INFINITY;
    for (const endTime of current.LastConcurrentlyReleasedHolds.map(((o: any) => (o?.EndTime ?? null)))) {
      if (((endTime === null) || (Math.abs((endTime - current.EndTime)) <= ChordUtils.CHORD_TOLERANCE_MS))) {
        continue;
      }
      closestReleaseDelta = Math.min(closestReleaseDelta, Math.abs((current.EndTime - endTime)));
    }
    if (((closestReleaseDelta) === Number.POSITIVE_INFINITY)) {
      return 0.0;
    }
    return (weight * DiffUtils.Logistic((slope * ((closestReleaseDelta - offset_ms))), longNoteGate));
  },

  calculateReleaseWhileHolds(current: ManiaDifficultyHitObject, longNoteGate: number): number {
    const release_long_note_weight = 0.4;
    let releasingColumns = current.TailOverlappedHolds.filter(((o: any) => (o != null))).length;
    if ((releasingColumns == 0)) {
      return 0.0;
    }
    let columnFactor = ((1.0 / (((((-25.0) / 66.0) * releasingColumns) - (5.0 / 11.0)))) + 2.2);
    return (((release_long_note_weight * columnFactor) * longNoteGate) * ReleaseEvaluator.nextNoteNerf(current));
  },

  nextNoteNerf(current: ManiaDifficultyHitObject): number {
    const min_ms = 40.0;
    const max_ms = 190.0;
    let nextInColumn = current.NextInColumn(0);
    if ((nextInColumn == null)) {
      return 1.0;
    }
    let gap = (nextInColumn.StartTime - current.EndTime);
    if ((gap <= min_ms)) {
      return 0.0;
    }
    if ((gap >= max_ms)) {
      return 1.0;
    }
    return DiffUtils.Smoothstep(gap, min_ms, max_ms);
  },

};

export default ReleaseEvaluator;
