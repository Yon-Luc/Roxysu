// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/FullChordJackEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../../src/adapters/hitObject";
import { ChordUtils } from "../../Utils/ChordUtils";
import { ColumnPatternUtils } from "../../Utils/ColumnPatternUtils";
import { ColumnRunUtils } from "../../Utils/ColumnRunUtils";
import { DiffUtils } from "../../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const min_chord = 4;
const scan_limit = 32;

/** Generated from C# class FullChordJackEvaluator */
export const FullChordJackEvaluator = {
  EvaluateMultiplierOf(current: ManiaDifficultyHitObject, columnDelta: number, baseStrain: number): number {
    let previous = current.Previous();
    if ((previous == null)) {
      return 1.0;
    }
    let fullChord = Math.max(min_chord, current.PreviousHitObjects.length);
    if ((current.Row.IsSameRow(previous.Row) || (previous.Row.Size < fullChord))) {
      return 1.0;
    }
    let speedGate = DiffUtils.Smoothstep(columnDelta, 100, 82);
    let manipGate = DiffUtils.ReverseLerp(current.ManipulationFactor, 0.95, 0.99);
    let runGate = DiffUtils.Smoothstep(ColumnRunUtils.RunLengthAround(current, (1.5 * columnDelta), scan_limit), 4, 3);
    let recurGate = FullChordJackEvaluator.fullChordRecurGate(current, fullChord, columnDelta);
    let localSize = ChordUtils.LocalChordSize(current, 4);
    let sizeDampen = (DiffUtils.Smoothstep(localSize, 1.90, 2.25) * DiffUtils.Smoothstep(localSize, 3.6, 2.5));
    let strainDampen = (1.0 - ((0.9 * DiffUtils.Smoothstep(baseStrain, 12, 15)) * DiffUtils.Smoothstep(localSize, 1.6, 2.0)));
    let looseDampen = (1.0 - (0.11 * DiffUtils.Smoothstep(FullChordJackEvaluator.chordlessJackTexture(current, fullChord), 0.45, 0.05)));
    return (1.0 + (((((((2.5 * speedGate) * manipGate) * runGate) * recurGate) * sizeDampen) * strainDampen) * looseDampen));
  },

  chordlessJackTexture(current: ManiaDifficultyHitObject, fullChord: number): number {
    let jackSteps = 0;
    let steps = 0;
    for (const row of current.Row.RowsAround(8)) {
      const previous = row.Previous();
      if ((((previous == null) || (row.Size >= fullChord)) || (previous.Size >= fullChord))) {
        continue;
      }
      (steps++);
      if (ColumnPatternUtils.SharesColumn(row.Columns, previous.Columns)) {
        (jackSteps++);
      }
    }
    return ((steps > 0) ? (Number(jackSteps) / steps) : 0.0);
  },

  fullChordRecurGate(current: ManiaDifficultyHitObject, fullChord: number, columnDelta: number): number {
    let window = (4.0 * columnDelta);
    let fullChords = 0;
    for (let i = 0; (i < scan_limit); (i++)) {
      let previous = current.Previous(i);
      if (((previous == null) || ((current.StartTime - previous.StartTime) > window))) {
        break;
      }
      if (((ChordUtils.DepthInChord(previous) == 1) && (previous.Row.Size >= fullChord))) {
        (fullChords++);
      }
    }
    return DiffUtils.Smoothstep(fullChords, 2, 1);
  },

};

export default FullChordJackEvaluator;
