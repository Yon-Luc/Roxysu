// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils.cs
// upstream sha: 1f2cc08cf06ca7644a02d1176537257b65d052f3
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";


/** Generated from C# class RunDampenUtils */
export const RunDampenUtils = {
  CapFor(runRamp: number): number {
    return (Math.trunc(Math.ceil(Math.max(1.0, runRamp))) + 1);
  },

  Dampen(run: number, runRamp: number, ceiling: number): number {
    return (1.0 - (ceiling * DiffUtils.ReverseLerp((run - 1), 0.0, Math.max(1.0, runRamp))));
  },

};

export default RunDampenUtils;
