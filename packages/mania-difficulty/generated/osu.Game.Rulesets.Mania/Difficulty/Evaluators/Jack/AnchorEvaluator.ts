// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/AnchorEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../../src/adapters/hitObject";
import { DiffUtils } from "../../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const window_ms = 400.0;
const tier_count = 3;

/** Generated from C# class AnchorEvaluator */
export const AnchorEvaluator = {
  EvaluateMultiplierOf(current: ManiaDifficultyHitObject): number {
    const anchor_buff = 1.0;
    const uneven = 0.40;
    const anchored = 0.85;
    let totalColumns = current.Row.TotalColumns;
    if ((totalColumns < 2)) {
      return 1.0;
    }
    let anchorValue = AnchorEvaluator.anchorValueOf(current, totalColumns);
    let multiplier = 1.0;
    for (let tier = 0; (tier < tier_count); (tier++)) {
      let step = (Number(tier) / tier_count);
      let gateStart = (uneven + (((anchored - uneven)) * step));
      let gateEnd = (anchored + (((1.0 - anchored)) * step));
      let buff = ((tier == (tier_count - 1)) ? (anchor_buff * tier_count) : anchor_buff);
      multiplier += (buff * DiffUtils.Smoothstep(anchorValue, gateStart, gateEnd));
    }
    return multiplier;
  },

  anchorValueOf(current: ManiaDifficultyHitObject, totalColumns: number): number {
    let usage = AnchorEvaluator.columnUsage(current, totalColumns);
    usage.sort((a: number, b: number) => a - b);
    usage.reverse();
    let walkSum = 0.0;
    let maxWalkSum = 0.0;
    for (let i = 0; ((i + 1) < totalColumns); (i++)) {
      let currentUsage = usage[i];
      let nextUsage = usage[(i + 1)];
      if ((nextUsage == 0.0)) {
        break;
      }
      let ratio = (nextUsage / currentUsage);
      let difference = (0.5 - ratio);
      let balanceFactor = (1.0 - ((4.0 * difference) * difference));
      walkSum += (currentUsage * balanceFactor);
      maxWalkSum += currentUsage;
    }
    return ((maxWalkSum != 0.0) ? (walkSum / maxWalkSum) : 0.0);
  },

  columnUsage(current: ManiaDifficultyHitObject, totalColumns: number): number[] {
    let usage = Array.from({ length: totalColumns }, () => 0);
    let center = current.StartTime;
    for (const row of current.Row.RowsWithin(window_ms, center)) {
      let distance = (Math.abs((row.StartTime - center)) / window_ms);
      let weight = (1.0 - (distance * distance));
      if ((weight <= 0.0)) {
        continue;
      }
      for (const column of row.Columns) {
        if (((column >= 0) && (column < totalColumns))) {
          usage[column] += weight;
        }
      }
    }
    return usage;
  },

};

export default AnchorEvaluator;
