// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils.cs
// upstream sha: 475a159368ae695a29a7d7ac50c59481bb98d384
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
