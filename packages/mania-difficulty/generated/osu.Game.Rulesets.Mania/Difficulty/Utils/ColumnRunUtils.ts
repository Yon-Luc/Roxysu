// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnRunUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";

export const DEFAULT_SCAN_LIMIT = 32;

/** Generated from C# class ColumnRunUtils */
export const ColumnRunUtils = {
  DEFAULT_SCAN_LIMIT,

  RunLengthAround(current: ManiaDifficultyHitObject, windowMs: number, scanLimit: number = DEFAULT_SCAN_LIMIT): number {
    let run = 1;
    let note = current;
    for (let back = 0; (back < scanLimit); (back++)) {
      let previous = current.PrevInColumn(back);
      if (((previous == null) || ((note.StartTime - previous.StartTime) > windowMs))) {
        break;
      }
      (run++);
      note = previous;
    }
    note = current;
    for (let forward = 0; (forward < scanLimit); (forward++)) {
      let next = current.NextInColumn(forward);
      if (((next == null) || ((next.StartTime - note.StartTime) > windowMs))) {
        break;
      }
      (run++);
      note = next;
    }
    return run;
  },

};

export default ColumnRunUtils;
