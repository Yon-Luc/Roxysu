// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils.cs
// upstream sha: bd6bbda8e649a806371d784a485d5962f709089e
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
