// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator.cs
// upstream sha: 475a159368ae695a29a7d7ac50c59481bb98d384
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { TrillUtils } from "../Utils/TrillUtils";

const speed_weight = 2.55;

/** Generated from C# class SpeedEvaluator */
export const SpeedEvaluator = {
  EvaluateDifficultyOf(hitObject: ManiaDifficultyHitObject): number {
    if ((hitObject.DeltaTime < ChordUtils.CHORD_TOLERANCE_MS)) {
      return 0.0;
    }
    const tap_rate_offset_ms = 36;
    const jack_speed_nerf = 0.5;
    let tapRate = (1000.0 / ((hitObject.DeltaTime + tap_rate_offset_ms)));
    tapRate *= SpeedEvaluator.speedGrowth(hitObject);
    const previous = hitObject.Previous();
    let isJack = ((previous != null) && (previous.Column == hitObject.Column));
    let patternMultiplier = (isJack ? jack_speed_nerf : TrillUtils.TrillFactor(hitObject));
    return (((((tapRate * patternMultiplier) * SpeedEvaluator.previousRowMultiplier(hitObject)) * hitObject.ManipulationFactor) * hitObject.EnduranceFactor) * speed_weight);
  },

  previousRowMultiplier(hitObject: ManiaDifficultyHitObject): number {
    const min_share = 0.85;
    const idle_ratio = 3.0;
    const idle_ratio_full = 6.0;
    let flow = hitObject.DeltaTime;
    if ((flow <= 0.0)) {
      return 1.0;
    }
    let ratio = (hitObject.ColumnDelta / flow);
    return (1.0 - (DiffUtils.Smoothstep(ratio, idle_ratio, idle_ratio_full) * ((1 - min_share))));
  },

  speedGrowth(hitObject: ManiaDifficultyHitObject): number {
    const window_ms = 250.0;
    const sustain_window_ms = 1000.0;
    let rows = 0;
    let longRows = 0;
    let longShared = 0;
    for (let p = hitObject.Row.Previous(); ((p != null) && ((hitObject.StartTime - p.StartTime) <= sustain_window_ms)); p = p.Previous() as typeof p) {
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
      sustainReward = (((0.75 * DiffUtils.Smoothstep(longRows, 20.0, 30.0)) * DiffUtils.Smoothstep(longEven, 0.6, 0.8)) * hitObject.ManipulationFactor);
    }
    return (spikeNerf * ((1.0 + sustainReward)));
  },

};

export default SpeedEvaluator;
