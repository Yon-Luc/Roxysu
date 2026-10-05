// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { AnchorEvaluator } from "./Jack/AnchorEvaluator";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { ColumnRunUtils } from "../Utils/ColumnRunUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { FullChordJackEvaluator } from "./Jack/FullChordJackEvaluator";
import { JackSpacingEvaluator } from "./Jack/JackSpacingEvaluator";
import { SpeedjackEvaluator } from "./Jack/SpeedjackEvaluator";
import { TrillUtils } from "../Utils/TrillUtils";

export const JACK_WINDOW_MS = 350.0;

/** Generated from C# class JackEvaluator */
export const JackEvaluator = {
  JACK_WINDOW_MS,

  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    const tap_rate_offset_ms = 60;
    const strain_exponent = 1.29407;
    const jack_multiplier = 0.5915;
    const total_weight = 1.19496;
    let columnDelta = current.ColumnDelta;
    if ((columnDelta > JACK_WINDOW_MS)) {
      return 0.0;
    }
    let chordDepth = ChordUtils.DepthInChord(current);
    let tapRate = (1000.0 / ((Math.max(columnDelta, 1.0) + tap_rate_offset_ms)));
    const pure_jump_chord_bonus = 0.7;
    const previousRow = current.Row.Previous();
    let sharesColumn = ((previousRow != null) && ColumnPatternUtils.SharesColumn(previousRow.Columns, current.Row.Columns));
    let chordBonusScale = (((chordDepth >= 2) && (!sharesColumn)) ? pure_jump_chord_bonus : 1.0);
    let jackDifficulty = (((tapRate * JackEvaluator.calculateChordJackBonus(current, chordDepth, columnDelta)) * chordBonusScale) * JackEvaluator.calculateSpeedBonus(tapRate));
    jackDifficulty = DiffUtils.Pow(jackDifficulty, strain_exponent);
    jackDifficulty *= JackEvaluator.calculateChordDepthMultiplier(current, chordDepth, columnDelta, sharesColumn);
    jackDifficulty *= JackEvaluator.calculateConcurrentHoldBonus(current);
    jackDifficulty *= FullChordJackEvaluator.EvaluateMultiplierOf(current, columnDelta, (jackDifficulty * jack_multiplier));
    jackDifficulty *= (((current.ManipulationFactor * current.EnduranceFactor) * SpeedjackEvaluator.EvaluateMultiplierOf(current)) * AnchorEvaluator.EvaluateMultiplierOf(current));
    jackDifficulty *= JackSpacingEvaluator.EvaluateMultiplierOf(current, chordDepth, columnDelta, tapRate);
    return ((jackDifficulty * jack_multiplier) * total_weight);
  },

  calculateChordJackBonus(current: ManiaDifficultyHitObject, chordDepth: number, columnDelta: number): number {
    return Math.max(0.1, (((1.0 + ((0.17460 * ChordUtils.ChordSpeedFactor(columnDelta)) * ((chordDepth - 1))))) * ChordUtils.ChordRepeatNerf(current, columnDelta)));
  },

  calculateSpeedBonus(tapRate: number): number {
    return (1.0 + (0.7 * DiffUtils.Logistic(tapRate, 5.0, 0.5)));
  },

  calculateChordDepthMultiplier(current: ManiaDifficultyHitObject, chordDepth: number, columnDelta: number, sharesColumn: boolean): number {
    const slow_ms = 140.0;
    const fast_ms = 100.0;
    const veryfast_ms = 84.0;
    const slow_mult = 0.6;
    const fast_mult = 1.4;
    const veryfast_mult = 0.75;
    const veryfast_open_mult = 1.45;
    if ((chordDepth < 2)) {
      return TrillUtils.TrillFactor(current);
    }
    let bpmScale = DiffUtils.Smoothstep(columnDelta, slow_ms, fast_ms);
    let chordSpeedMultiplier = (slow_mult + (((fast_mult - slow_mult)) * bpmScale));
    let rollable = Math.max(DiffUtils.Smoothstep(ChordUtils.LocalChordSize(current), 1.9, 2.5), DiffUtils.Smoothstep(ColumnRunUtils.RunLengthAround(current, (1.5 * columnDelta), 32), 2.5, 4.0));
    let fastRolloff = DiffUtils.Smoothstep(columnDelta, fast_ms, veryfast_ms);
    let veryfastMultiplier = (veryfast_open_mult + (((veryfast_mult - veryfast_open_mult)) * rollable));
    chordSpeedMultiplier += (((veryfastMultiplier - fast_mult)) * fastRolloff);
    return (ChordUtils.CHORDJACK_NERF * chordSpeedMultiplier);
  },

  calculateConcurrentHoldBonus(current: ManiaDifficultyHitObject): number {
    let totalColumns = current.PreviousHitObjects.length;
    if ((totalColumns == 1)) {
      return 1.0;
    }
    let heldFraction = (current.ConcurrentlyHeldColumns(ChordUtils.CHORD_TOLERANCE_MS) / Number(((totalColumns - 1))));
    return (1.0 + (0.75 * heldFraction));
  },

};

export default JackEvaluator;
