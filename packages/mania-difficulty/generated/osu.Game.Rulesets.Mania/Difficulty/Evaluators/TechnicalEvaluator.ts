// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { CrossColumnUtils } from "../Utils/CrossColumnUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const variety_gap_log_base = 1.18;

/** Generated from C# class TechnicalEvaluator */
export const TechnicalEvaluator = {
  EvaluateDifficultyOf(hitObject: ManiaDifficultyHitObject, rhythmIrregularity: number, patternVariety: number, windowedIrregularity: number): number {
    const pattern_buff = 0.69740;
    const technical_scale = 1.95;
    const total_weight = 1.58087;
    let columnComplexity = TechnicalEvaluator.evaluateColumnComplexityOf(hitObject);
    let speedFactor = (1.0 / (((hitObject.DeltaTime / 1000.0) + 0.060)));
    let readingPressure = TechnicalEvaluator.readingPressureOf(hitObject);
    let rhythmAmplifier = (1.0 + ((0.9 * readingPressure) * DiffUtils.BellCurve(windowedIrregularity, 0.15, 0.085)));
    let varietyFloor = (((1.55 * patternVariety) * readingPressure) * DiffUtils.Smoothstep(windowedIrregularity, 0.04, 0.12));
    let complexity = Math.max((rhythmIrregularity + columnComplexity), varietyFloor);
    return (((((((pattern_buff * complexity) * speedFactor) * technical_scale) * rhythmAmplifier) * TechnicalEvaluator.chordWidth(hitObject)) * hitObject.ManipulationFactor) * total_weight);
  },

  EvaluateRhythmIrregularityOf(hitObject: ManiaDifficultyHitObject, previousDeltaTime: number): number {
    if ((previousDeltaTime <= ChordUtils.CHORD_TOLERANCE_MS)) {
      return 0.0;
    }
    let ratio = (hitObject.DeltaTime / previousDeltaTime);
    if ((ratio > 1.0)) {
      ratio = (1.0 / ratio);
    }
    return (1.0 - ratio);
  },

  EvaluateShapeOf(hitObject: ManiaDifficultyHitObject): { rhythmClass: number; direction: number } {
    let rhythmClass = Math.trunc(Math.round((Math.log(hitObject.DeltaTime) / Math.log(variety_gap_log_base))));
    const previous = hitObject.Previous();
    let direction = ((previous != null) ? Math.sign((hitObject.Column - previous.Column)) : 0);
    return { rhythmClass: rhythmClass, direction: direction };
  },

  EvaluatePatternVarietyOf(distinctShapeCount: number, totalColumns: number): number {
    let keyScale = Math.min(1.45, (1.0 + (0.125 * Math.max(0, (totalColumns - 4)))));
    return DiffUtils.Smoothstep(distinctShapeCount, (2.5 * keyScale), (5.5 * keyScale));
  },

  readingPressureOf(hitObject: ManiaDifficultyHitObject): number {
    return DiffUtils.Smoothstep(hitObject.DeltaTime, 95, 48);
  },

  chordWidth(hitObject: ManiaDifficultyHitObject): number {
    let passage = TechnicalEvaluator.readPassageAround(hitObject);
    let density = DiffUtils.Smoothstep(passage.wideShare, 0.30, 0.60);
    let moves = DiffUtils.Smoothstep(passage.jackShare, 0.90, 0.65);
    let reforms = DiffUtils.Smoothstep(passage.shapeChange, 0.25, 0.65);
    let keymode = Math.min(hitObject.Row.TotalColumns, 9);
    let lightGate = (1.0 - DiffUtils.Smoothstep(hitObject.Row.Size, (keymode * 0.4), (((keymode + 9.5)) / 3.0)));
    return (((1.0 + (((1.9 * density) * moves) * reforms))) * lightGate);
  },

  readPassageAround(hitObject: ManiaDifficultyHitObject): { wideShare: number; jackShare: number; shapeChange: number } {
    const wide_fill = 0.7;
    let wide = 0;
    let rows = 0;
    let shared = 0;
    let steps = 0;
    let wideSteps = 0;
    let wideChanges = 0;
    for (const row of hitObject.Row.RowsAround(14)) {
      (rows++);
      let isWide = (row.Size >= (wide_fill * row.TotalColumns));
      if (isWide) {
        (wide++);
      }
      const previous = row.Previous();
      if ((previous == null)) {
        continue;
      }
      (steps++);
      if (ColumnPatternUtils.SharesColumn(row.Columns, previous.Columns)) {
        (shared++);
      }
      if (((!isWide) || (previous.Size < (wide_fill * previous.TotalColumns)))) {
        continue;
      }
      (wideSteps++);
      if ((!ColumnPatternUtils.SameColumns(row.Columns, previous.Columns))) {
        (wideChanges++);
      }
    }
    return { wideShare: ((rows > 0) ? (Number(wide) / rows) : 0.0), jackShare: ((steps > 0) ? (Number(shared) / steps) : 0.0), shapeChange: ((wideSteps > 0) ? (Number(wideChanges) / wideSteps) : 1.0) };
  },

  evaluateColumnComplexityOf(hitObject: ManiaDifficultyHitObject): number {
    const previous = hitObject.Previous();
    const previous2 = hitObject.Previous(1);
    if (((previous == null) || (previous2 == null))) {
      return 0.0;
    }
    let columnComplexity = 0.0;
    let previousDirection = (previous.Column - previous2.Column);
    let currentDirection = (hitObject.Column - previous.Column);
    if ((((previousDirection != 0) && (currentDirection != 0)) && (Math.sign(previousDirection) != Math.sign(currentDirection)))) {
      let coefficient = CrossColumnUtils.SumBoundaryMultipliersBetween(previous.Column, hitObject.Column, hitObject.Row.TotalColumns);
      columnComplexity += (0.45 + (2.0 * coefficient));
    }
    if ((Math.abs(currentDirection) >= 2)) {
      columnComplexity += CrossColumnUtils.AverageBoundaryMultipliersBetween(previous.Column, hitObject.Column, hitObject.Row.TotalColumns);
    }
    let spanDamper = (1.0 - (0.60 * DiffUtils.Smoothstep(Math.abs(currentDirection), 3.0, 5.5)));
    return (columnComplexity * spanDamper);
  },

};

export default TechnicalEvaluator;
