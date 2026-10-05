// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { CrossColumnUtils } from "../Utils/CrossColumnUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { JackEvaluator } from "./JackEvaluator";
import { TrillUtils } from "../Utils/TrillUtils";


/** Generated from C# class CoordinationEvaluator */
export const CoordinationEvaluator = {
  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    const total_weight = 1.81659;
    let coordinationDifficulty = CoordinationEvaluator.calculateBoundaryPressure(current);
    let columnDelta = current.ColumnDelta;
    let depthInChord = ChordUtils.DepthInChord(current);
    coordinationDifficulty += CoordinationEvaluator.calculateChordDifficulty(current, depthInChord, columnDelta);
    coordinationDifficulty += CoordinationEvaluator.calculateHoldDifficulty(current);
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
    const boundary_pressure_weight = 1.14529;
    let column = current.Column;
    let totalColumns = current.Row.TotalColumns;
    let total = 0.0;
    if ((column > 0)) {
      total += CoordinationEvaluator.columnBoundaryPressure(current, column, true, totalColumns);
    }
    if ((column < (totalColumns - 1))) {
      total += CoordinationEvaluator.columnBoundaryPressure(current, column, false, totalColumns);
    }
    return (((total * TrillUtils.TrillFactor(current)) * boundary_pressure_weight) * CoordinationEvaluator.densityDampenFor(current, totalColumns));
  },

  columnBoundaryPressure(current: ManiaDifficultyHitObject, column: number, left: boolean, totalColumns: number): number {
    const scale_ms = 1300.0;
    const min_delta_ms = 35.0;
    const activity_window_ms = 450.0;
    let adjacentColumn = (left ? (column - 1) : (column + 1));
    let adjacentStartTime = current.LastStartTimeInColumn(adjacentColumn);
    if (((adjacentStartTime) === Number.NEGATIVE_INFINITY)) {
      return 0.0;
    }
    let adjacentDelta = (current.StartTime - adjacentStartTime);
    if ((adjacentDelta < ChordUtils.CHORD_TOLERANCE_MS)) {
      return 0.0;
    }
    let boundaryIndex = (left ? column : (column + 1));
    let intensity = (scale_ms / ((adjacentDelta + min_delta_ms)));
    let coefficient = CrossColumnUtils.ColumnBoundaryMultiplier(boundaryIndex, totalColumns);
    let otherActive = (adjacentDelta <= activity_window_ms);
    return ((intensity * coefficient) * ((otherActive ? 1.0 : ((1.0 - coefficient)))));
  },

  densityDampenFor(current: ManiaDifficultyHitObject, totalColumns: number): number {
    const density_window_ms = 180.0;
    const note_cap = 3.0;
    const density_dampen_end = 8.0;
    const density_dampen_max = 0.91;
    let liveNeighbours = 0;
    if ((current.Row.Size >= Math.min(3, (Math.floor((totalColumns / 3.0)) + 1)))) {
      return 1.0;
    }
    for (let otherColumn = 0; (otherColumn < totalColumns); (otherColumn++)) {
      if ((otherColumn == current.Column)) {
        continue;
      }
      let otherStart = current.LastStartTimeInColumn(otherColumn);
      if (((otherStart) === Number.NEGATIVE_INFINITY)) {
        continue;
      }
      let otherDelta = (current.StartTime - otherStart);
      if ((otherDelta < ChordUtils.CHORD_TOLERANCE_MS)) {
        continue;
      }
      if ((otherDelta <= density_window_ms)) {
        (liveNeighbours++);
      }
    }
    if ((liveNeighbours < note_cap)) {
      return 1.0;
    }
    let x = Math.min(1.0, (((liveNeighbours - note_cap)) / ((density_dampen_end - note_cap))));
    return (1.0 - (((density_dampen_max * x) * x) * ((3.0 - (2.0 * x)))));
  },

  calculateChordDifficulty(current: ManiaDifficultyHitObject, depthInChord: number, columnDelta: number): number {
    const load_per_extra_column = 0.9;
    const shapeBonusWeight = 1.2;
    if ((depthInChord < 2)) {
      return 0.0;
    }
    let isChordjack = (columnDelta <= JackEvaluator.JACK_WINDOW_MS);
    let difficulty = (((((load_per_extra_column * ((depthInChord - 1))) * ChordUtils.ChordRepeatNerf(current, columnDelta)) * ((isChordjack ? ChordUtils.CHORDJACK_NERF : 1.0))) * ChordUtils.ChordSpeedFactor(columnDelta)) + (shapeBonusWeight * CoordinationEvaluator.calculateShapeBonus(current, columnDelta)));
    const previousShape = current.Row.Previous();
    if (((previousShape != null) && ColumnPatternUtils.SameColumns(previousShape.Columns, current.Row.Columns))) {
      difficulty *= 0.5;
    }
    return (difficulty / Math.log(current.Row.Size));
  },

  calculateShapeBonus(current: ManiaDifficultyHitObject, columnDelta: number): number {
    const previous = current.Row.Previous();
    if ((((previous == null) || (previous.Size < 2)) || (!ColumnPatternUtils.SharesColumn(previous.Columns, current.Row.Columns)))) {
      return 0.0;
    }
    let shapeBonus = DiffUtils.Smoothstep(ColumnPatternUtils.ChordDifference(previous.Columns, current.Row.Columns), 0.3, 0.75);
    let shared = ColumnPatternUtils.SharedColumnCount(previous.Columns, current.Row.Columns);
    if ((shared > 0)) {
      let keymode = Math.min(current.Row.TotalColumns, 9);
      shapeBonus *= Math.pow((0.57 + (keymode * 0.03)), shared);
    }
    return (shapeBonus * ((1.0 - DiffUtils.Smoothstep(columnDelta, 100.0, 200.0))));
  },

  calculateHoldDifficulty(current: ManiaDifficultyHitObject): number {
    const held_long_note_weight = 0.25;
    const held_speed_factor_offset = 0.08;
    const hold_start_cap_end_ms = 35.0;
    const soft_ceiling_midpoint = 2.719;
    let heldColumns = current.ConcurrentlyHeldColumns(ChordUtils.CHORD_TOLERANCE_MS);
    if ((heldColumns == 0)) {
      return 0.0;
    }
    let heldSpeedFactor = ((current.DeltaTime >= ChordUtils.CHORD_TOLERANCE_MS) ? (1.0 / (((current.DeltaTime / 1000.0) + held_speed_factor_offset))) : 1.0);
    let columnFactor = ((1.0 / (((((-25.0) / 66.0) * heldColumns) - (5.0 / 11.0)))) + 2.2);
    let holdDifficulty = (columnFactor * heldSpeedFactor);
    let difficultyCap = (soft_ceiling_midpoint / ((soft_ceiling_midpoint + holdDifficulty)));
    let holdStartCap = DiffUtils.Smoothstep(current.DeltaTime, ChordUtils.CHORD_TOLERANCE_MS, hold_start_cap_end_ms);
    return (((holdStartCap * held_long_note_weight) * holdDifficulty) * difficultyCap);
  },

};

export default CoordinationEvaluator;
