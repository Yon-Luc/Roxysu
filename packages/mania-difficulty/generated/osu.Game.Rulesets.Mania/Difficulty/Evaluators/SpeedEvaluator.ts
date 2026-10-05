// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { TrillUtils } from "../Utils/TrillUtils";


/** Generated from C# class SpeedEvaluator */
export const SpeedEvaluator = {
  EvaluateDifficultyOf(hitObject: ManiaDifficultyHitObject): number {
    if ((hitObject.DeltaTime < ChordUtils.CHORD_TOLERANCE_MS)) {
      return 0.0;
    }
    const tap_rate_offset_ms = 36;
    const speed_weight = 1.613;
    const jack_speed_nerf = 0.49996;
    const total_weight = 1.01112;
    let tapRate = (1000.0 / ((hitObject.DeltaTime + tap_rate_offset_ms)));
    tapRate *= SpeedEvaluator.speedGrowth(hitObject);
    const previous = hitObject.Previous();
    let isJack = ((previous != null) && (previous.Column == hitObject.Column));
    let patternMultiplier = (isJack ? jack_speed_nerf : TrillUtils.TrillFactor(hitObject));
    return (((((tapRate * patternMultiplier) * speed_weight) * hitObject.ManipulationFactor) * hitObject.EnduranceFactor) * total_weight);
  },

  speedGrowth(hitObject: ManiaDifficultyHitObject): number {
    const window_ms = 200.0;
    const sustain_window_ms = 700.0;
    let rows = 0;
    let longRows = 0;
    let longShared = 0;
    for (let p = hitObject.Row.Previous(); ((p != null) && ((hitObject.StartTime - p.StartTime) <= sustain_window_ms)); p = p.Previous()) {
      (longRows++);
      if (ColumnPatternUtils.SharesColumn(hitObject.Row.Columns, p.Columns)) {
        (longShared++);
      }
      if (((hitObject.StartTime - p.StartTime) <= window_ms)) {
        (rows++);
      }
    }
    let spikeNerf = 1.0;
    if ((rows >= 4)) {
      let rowGap = hitObject.Row.GapBefore;
      if (((!((rowGap) === Number.POSITIVE_INFINITY)) && (rowGap > 0.0))) {
        let ratio = (((1000.0 / rowGap)) / ((rows / ((window_ms / 1000.0)))));
        spikeNerf = (1.0 - (0.5 * DiffUtils.Smoothstep(ratio, 2.0, 4.0)));
      }
    }
    let sustainReward = 0.0;
    if ((longRows >= 20)) {
      let longEven = (1.0 - (Number(longShared) / longRows));
      sustainReward = (((0.8 * DiffUtils.Smoothstep(longRows, 20.0, 30.0)) * DiffUtils.Smoothstep(longEven, 0.6, 0.8)) * hitObject.ManipulationFactor);
    }
    return (spikeNerf * ((1.0 + sustainReward)));
  },

};

export default SpeedEvaluator;
