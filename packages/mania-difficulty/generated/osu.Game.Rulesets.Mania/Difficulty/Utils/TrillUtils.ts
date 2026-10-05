// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/TrillUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { RunDampenUtils } from "./RunDampenUtils";

const trill_nerf = 0.62864;
const trill_run_ramp = 4.99947;

/** Generated from C# class TrillUtils */
export const TrillUtils = {
  IsTrillStep(hitObject: ManiaDifficultyHitObject): boolean {
    const previous = hitObject.Previous();
    const previous2 = hitObject.Previous(1);
    if (((previous == null) || (previous2 == null))) {
      return false;
    }
    return ((previous.Column != hitObject.Column) && (previous2.Column == hitObject.Column));
  },

  TrillFactor(current: ManiaDifficultyHitObject): number {
    if ((!TrillUtils.IsTrillStep(current))) {
      return 1.0;
    }
    let cap = RunDampenUtils.CapFor(trill_run_ramp);
    let run = 1;
    let trillStep = current;
    while ((run < cap)) {
      const previousNote = trillStep.Previous();
      if (((previousNote == null) || (!TrillUtils.IsTrillStep(previousNote)))) {
        break;
      }
      (run++);
      trillStep = previousNote;
    }
    return RunDampenUtils.Dampen(run, trill_run_ramp, (1.0 - trill_nerf));
  },

};

export default TrillUtils;
