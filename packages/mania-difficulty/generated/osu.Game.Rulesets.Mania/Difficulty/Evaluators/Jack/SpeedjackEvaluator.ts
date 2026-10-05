// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/SpeedjackEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../../src/adapters/hitObject";
import type { ManiaRow } from "../../../../../src/adapters/hitObject";
import { ColumnPatternUtils } from "../../Utils/ColumnPatternUtils";
import { DiffUtils } from "../../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const slowest_speedjack_ms = 110.0;

/** Generated from C# class SpeedjackEvaluator */
export const SpeedjackEvaluator = {
  EvaluateMultiplierOf(current: ManiaDifficultyHitObject): number {
    let row = current.Row;
    let previous = row.Previous();
    let previous2 = row.Previous(1);
    if (((previous == null) || (previous2 == null))) {
      return 1.0;
    }
    let speedScale = DiffUtils.Smoothstep(row.GapBefore, slowest_speedjack_ms, 70);
    if ((speedScale <= 0.0)) {
      return 1.0;
    }
    let isFullRepeat = (ColumnPatternUtils.SameColumns(row.Columns, previous.Columns) || ColumnPatternUtils.SameColumns(row.Columns, previous2.Columns));
    let isRoll = ColumnPatternUtils.IsRoll(previous.Columns, row.Columns);
    let sharesJack = (ColumnPatternUtils.SharesColumn(row.Columns, previous.Columns) || ColumnPatternUtils.SharesColumn(row.Columns, previous2.Columns));
    if (((isFullRepeat || isRoll) || (!sharesJack))) {
      return 1.0;
    }
    let clean = (1.0 - SpeedjackEvaluator.localJumptrillRollDensity(row));
    if ((clean <= 0.0)) {
      return 1.0;
    }
    let sizeGate = ((row.Size <= 1) ? 0.5 : (1.0 - (0.8 * DiffUtils.Smoothstep(row.Size, 2.0, 4.0))));
    return (1.0 + (((0.35 * speedScale) * sizeGate) * clean));
  },

  localJumptrillRollDensity(row: ManiaRow): number {
    let window = 0;
    let manipulable = 0;
    for (let current: ManiaRow | null = row; ((current != null) && (window < 6)); current = current.Previous()) {
      (window++);
      let previous = current.Previous();
      let previous2 = current.Previous(1);
      if (((previous == null) || (previous2 == null))) {
        continue;
      }
      if ((current.GapBefore > slowest_speedjack_ms)) {
        continue;
      }
      let isJumptrill = ColumnPatternUtils.IsRecurrence(previous2.Columns, previous.Columns, current.Columns);
      let isRoll = ColumnPatternUtils.IsRoll(previous.Columns, current.Columns);
      if ((isJumptrill || isRoll)) {
        (manipulable++);
      }
    }
    return ((window > 0) ? (Number(manipulable) / window) : 0.0);
  },

};

export default SpeedjackEvaluator;
