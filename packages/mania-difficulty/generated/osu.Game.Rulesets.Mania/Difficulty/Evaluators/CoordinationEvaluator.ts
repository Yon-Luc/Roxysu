// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator.cs
// upstream sha: 1f2cc08cf06ca7644a02d1176537257b65d052f3
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { CrossColumnUtils } from "../Utils/CrossColumnUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { TrillUtils } from "../Utils/TrillUtils";

const coordination_multiplier = 2.22;

/** Generated from C# class CoordinationEvaluator */
export const CoordinationEvaluator = {
  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    let coordinationDifficulty = CoordinationEvaluator.calculateBoundaryPressure(current);
    let columnDelta = current.ColumnDelta;
    let depthInChord = ChordUtils.DepthInChord(current);
    coordinationDifficulty += CoordinationEvaluator.calculateChordDifficulty(current, depthInChord, columnDelta);
    coordinationDifficulty += CoordinationEvaluator.calculateShieldDifficulty(current);
    coordinationDifficulty += CoordinationEvaluator.calculateNoteWhileHolds(current);
    coordinationDifficulty *= CoordinationEvaluator.minijackPressure(current);
    coordinationDifficulty *= (current.ManipulationFactor * current.EnduranceFactor);
    return (coordinationDifficulty * coordination_multiplier);
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
    return (((intensity * coefficient) * ((otherActive ? 1.0 : ((1.0 - coefficient))))) * CoordinationEvaluator.previousGapMultiplier(current, adjacentDelta));
  },

  previousGapMultiplier(current: ManiaDifficultyHitObject, adjacentDelta: number): number {
    const min_share = 0.2;
    let ratio = (current.ColumnDelta / adjacentDelta);
    return (1.0 - (DiffUtils.Smoothstep(ratio, 2.5, 5.0) * ((1 - min_share))));
  },

  calculateChordDifficulty(current: ManiaDifficultyHitObject, depthInChord: number, columnDelta: number): number {
    const load_per_extra_column = 2.69;
    const shapeBonusWeight = 2.4;
    if ((depthInChord < 2)) {
      return 0.0;
    }
    let chordjackValue = CoordinationEvaluator.calculateChordjackValue(current);
    const previous = current.Row.Previous();
    let balanceRatio = ((previous != null) ? (Number(Math.min(previous.Size, current.Row.Size)) / Math.max(previous.Size, current.Row.Size)) : 1.0);
    let difficulty = (((((load_per_extra_column * ((depthInChord - 1))) * balanceRatio) * ChordUtils.ChordRepeatNerf(current, columnDelta)) * ChordUtils.ChordSpeedFactor(columnDelta)) + (shapeBonusWeight * CoordinationEvaluator.calculateShapeBonus(current, columnDelta)));
    return (difficulty * CoordinationEvaluator.chordjackMultiplier(chordjackValue));
  },

  calculateChordjackValue(current: ManiaDifficultyHitObject): number {
    const previous = current.Row.Previous();
    if ((previous == null)) {
      return 0.0;
    }
    let shared = ColumnPatternUtils.SharedColumnCount(previous.Columns, current.Row.Columns);
    let averageSize = (((previous.Size + current.Row.Size)) / 2.0);
    return ((averageSize > 0.0) ? (shared / averageSize) : 0.0);
  },

  chordjackMultiplier(chordjackValue: number): number {
    if ((chordjackValue <= 0.0)) {
      return 1.0;
    }
    const centre = 0.5;
    const buff = 0.48;
    const nerf = 0.6;
    return ((chordjackValue < centre) ? (1.0 + ((buff * ((centre - chordjackValue))) / centre)) : (1.0 - ((nerf * ((chordjackValue - centre))) / ((1.0 - centre)))));
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
    const shield_weight = 1.00;
    const jack_scale_ms = 120.0;
    const jack_intensity = 320000.0;
    const min_shield_ms = 150;
    const full_shield_ms = 600;
    let holdLength = (current.EndTime - current.StartTime);
    if ((holdLength <= 0.0)) {
      return 0.0;
    }
    if ((current.PrevInColumn(0) === null)) {
      return 0.0;
    }
    let intensity = Math.min((jack_intensity / ((current.ColumnDelta * ((current.ColumnDelta + jack_scale_ms))))), 20.0);
    return ((shield_weight * intensity) * DiffUtils.ReverseLerp(holdLength, min_shield_ms, full_shield_ms));
  },

  calculateNoteWhileHolds(current: ManiaDifficultyHitObject): number {
    const held_note_weight = 1.5;
    return (held_note_weight * ((current.HeldNoteMultiplier - 1.0)));
  },

  minijackPressure(hitObject: ManiaDifficultyHitObject): number {
    const minijack_pressure_weight = 2.5;
    const minijack_other_penalty = 0.9;
    const minijack_mult_floor = 0.02;
    const window_ms_minijack = 300.0;
    const minijack_fast_ms = 40.0;
    const minijack_slow_ms = 135.0;
    const acceleration_min = 1.0;
    const acceleration_max = 2.5;
    const density_window_ms = 400.0;
    const density_low = 2.0;
    const density_high = 4.0;
    const similar_gap_margin = 1.0;
    const runup_short_ms = 200.0;
    const runup_long_ms = 800.0;
    const runup_floor = 1.0;
    const runup_reward_weight = 0.5;
    const local_density_window_ms = 250.0;
    const local_density_low = 1.5;
    const local_density_high = 3.5;
    const previousNote = hitObject.PrevInColumn(0);
    if ((previousNote == null)) {
      return 1.0;
    }
    let jackDelta = (hitObject.StartTime - previousNote.StartTime);
    const beforePrevious = previousNote.PrevInColumn(0);
    let previousPartDelta = ((beforePrevious != null) ? (previousNote.StartTime - beforePrevious.StartTime) : 0.0);
    let acceleration = ((previousPartDelta > 0.0) ? (previousPartDelta / Math.max(jackDelta, 1.0)) : 1.0);
    let speedUp = DiffUtils.Smoothstep(acceleration, acceleration_min, acceleration_max);
    let runUpFactor = (runup_floor + (runup_reward_weight * DiffUtils.Smoothstep(previousPartDelta, runup_short_ms, runup_long_ms)));
    let localNotes = 0;
    for (let row = hitObject.Row.Previous(); ((row != null) && ((hitObject.StartTime - row.StartTime) <= local_density_window_ms)); row = row.Previous() as typeof row) {
      localNotes += row.Size;
    }
    let localDensity = DiffUtils.Smoothstep(localNotes, local_density_low, local_density_high);
    let minijackMult = DiffUtils.Smoothstep(jackDelta, minijack_slow_ms, minijack_fast_ms);
    if ((minijackMult <= 0)) {
      return 1.0;
    }
    for (const column of hitObject.Row.Columns) {
      if ((column == hitObject.Column)) {
        continue;
      }
      const neighbour = hitObject.PrevInColumnBefore(column, hitObject.Index);
      const before = neighbour != null ? hitObject.PrevInColumnBefore(column, neighbour.Index) : null;
      if (((neighbour == null) || (before == null))) {
        continue;
      }
      let otherDelta = (neighbour.StartTime - before.StartTime);
      if ((otherDelta > window_ms_minijack)) {
        continue;
      }
      minijackMult -= (DiffUtils.Smoothstep(otherDelta, minijack_fast_ms, minijack_slow_ms) * minijack_other_penalty);
    }
    let similarOrFaster = 0;
    for (let earlier = previousNote; ((earlier != null) && ((hitObject.StartTime - earlier.StartTime) <= density_window_ms)); earlier = earlier.PrevInColumn(0) as typeof earlier) {
      const before = earlier.PrevInColumn(0);
      if ((before == null)) {
        break;
      }
      let gap = (earlier.StartTime - before.StartTime);
      if ((gap <= (jackDelta * similar_gap_margin))) {
        (similarOrFaster++);
      }
    }
    let densityGate = (1.0 - DiffUtils.Smoothstep(similarOrFaster, density_low, density_high));
    return (1.0 + (((((minijack_pressure_weight * speedUp) * runUpFactor) * localDensity) * densityGate) * Math.max(minijackMult, minijack_mult_floor)));
  },

};

export default CoordinationEvaluator;
