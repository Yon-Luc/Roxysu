// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator.cs
// upstream sha: bd6bbda8e649a806371d784a485d5962f709089e
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { CrossColumnUtils } from "../Utils/CrossColumnUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { TrillUtils } from "../Utils/TrillUtils";


/** Generated from C# class CoordinationEvaluator */
export const CoordinationEvaluator = {
  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    const total_weight = 1.81659;
    let coordinationDifficulty = CoordinationEvaluator.calculateBoundaryPressure(current);
    let columnDelta = current.ColumnDelta;
    let depthInChord = ChordUtils.DepthInChord(current);
    coordinationDifficulty += CoordinationEvaluator.calculateChordDifficulty(current, depthInChord, columnDelta);
    coordinationDifficulty += CoordinationEvaluator.calculateShieldDifficulty(current);
    coordinationDifficulty *= (current.ManipulationFactor * current.EnduranceFactor);
    return CoordinationEvaluator.saturate((coordinationDifficulty * total_weight));
  },

  saturate(strain: number): number {
    const threshold = 13.0;
    const strength = 0.75;
    const width = 1.5;
    let z = (((strain - threshold)) / width);
    let softExcess = (width * ((Math.max(z, 0.0) + Math.log((1.0 + Math.exp((-Math.abs(z))))))));
    return (strain - (strength * softExcess));
  },

  calculateBoundaryPressure(current: ManiaDifficultyHitObject): number {
    const boundary_pressure_weight = 1.07;
    let column = current.Column;
    let totalColumns = current.Row.TotalColumns;
    let total = 0.0;
    if ((column > 0)) {
      total += CoordinationEvaluator.columnBoundaryPressure(current, column, true, totalColumns);
    }
    if ((column < (totalColumns - 1))) {
      total += CoordinationEvaluator.columnBoundaryPressure(current, column, false, totalColumns);
    }
    return ((total * TrillUtils.TrillFactor(current)) * boundary_pressure_weight);
  },

  columnBoundaryPressure(current: ManiaDifficultyHitObject, column: number, left: boolean, totalColumns: number): number {
    const scale_ms = 1300.0;
    const min_delta_ms = 35.0;
    const activity_window_ms = 450.0;
    let adjacentColumn = (left ? (column - 1) : (column + 1));
    if ((current.Row.Columns.indexOf(adjacentColumn) >= 0)) {
      return 0.0;
    }
    let adjacentStartTime = current.LastStartTimeInColumn(adjacentColumn);
    if (((adjacentStartTime) === Number.NEGATIVE_INFINITY)) {
      return 0.0;
    }
    let adjacentDelta = (current.StartTime - adjacentStartTime);
    if ((adjacentDelta < ChordUtils.CHORD_TOLERANCE_MS)) {
      return 0.0;
    }
    let boundaryIndex = (left ? column : (column + 1));
    let intensity = Math.min((scale_ms / ((adjacentDelta + min_delta_ms))), 20.0);
    let coefficient = CrossColumnUtils.ColumnBoundaryMultiplier(boundaryIndex, totalColumns);
    let otherActive = (adjacentDelta <= activity_window_ms);
    return (((intensity * coefficient) * ((otherActive ? 1.0 : ((1.0 - coefficient))))) * CoordinationEvaluator.previousRowMultiplier(current, adjacentDelta));
  },

  previousRowMultiplier(current: ManiaDifficultyHitObject, adjacentDelta: number): number {
    const min_share = 0.3;
    let ratio = (current.ColumnDelta / adjacentDelta);
    return (1.0 - (DiffUtils.Smoothstep(ratio, 2.0, 6.0) * ((1 - min_share))));
  },

  calculateChordDifficulty(current: ManiaDifficultyHitObject, depthInChord: number, columnDelta: number): number {
    const load_per_extra_column = 1.5;
    const shapeBonusWeight = 2.5;
    if ((depthInChord < 2)) {
      return 0.0;
    }
    const previousShape = current.Row.Previous();
    let isChordjack = ((previousShape != null) && ColumnPatternUtils.SameColumns(previousShape.Columns, current.Row.Columns));
    let difficulty = (((((load_per_extra_column * ((depthInChord - 1))) * ChordUtils.ChordRepeatNerf(current, columnDelta)) * ((isChordjack ? ChordUtils.CHORDJACK_NERF : 1.0))) * ChordUtils.ChordSpeedFactor(columnDelta)) + (shapeBonusWeight * CoordinationEvaluator.calculateShapeBonus(current, columnDelta)));
    if (isChordjack) {
      difficulty *= 0.5;
    }
    return difficulty;
  },

  calculateShapeBonus(current: ManiaDifficultyHitObject, columnDelta: number): number {
    const previous = current.Row.Previous();
    if ((((previous == null) || (previous.Size < 1)) || (!ColumnPatternUtils.SharesColumn(previous.Columns, current.Row.Columns)))) {
      return 0.0;
    }
    let shapeBonus = DiffUtils.Smoothstep(ColumnPatternUtils.ChordDifference(previous.Columns, current.Row.Columns), 0.3, 0.75);
    let shared = ColumnPatternUtils.SharedColumnCount(previous.Columns, current.Row.Columns);
    if ((shared > 1)) {
      let keymode = Math.min(current.Row.TotalColumns, 9);
      shapeBonus *= Math.pow((0.61 + (keymode * 0.04)), shared);
    }
    return (shapeBonus * ((1.0 - DiffUtils.Smoothstep(columnDelta, 100.0, 200.0))));
  },

  calculateShieldDifficulty(current: ManiaDifficultyHitObject): number {
    const shield_weight = 0.75;
    const scale_ms = 1300.0;
    const min_delta_ms = 35.0;
    const min_shield_ms = 250.0;
    const full_shield_ms = 800.0;
    let holdLength = (current.EndTime - current.StartTime);
    if ((holdLength <= 0.0)) {
      return 0.0;
    }
    if ((current.PrevInColumn(0) === null)) {
      return 0.0;
    }
    let intensity = Math.min((scale_ms / ((current.DeltaTime + min_delta_ms))), 20.0);
    return ((shield_weight * intensity) * DiffUtils.ReverseLerp(holdLength, min_shield_ms, full_shield_ms));
  },

};

export default CoordinationEvaluator;
