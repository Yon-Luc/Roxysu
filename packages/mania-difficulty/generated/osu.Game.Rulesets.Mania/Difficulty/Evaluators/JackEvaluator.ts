// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator.cs
// upstream sha: 1859fda79775fabbd451b625b7fef6f90aabab13
// generator: 0.5.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { AnchorEvaluator } from "./Jack/AnchorEvaluator";
import { ChordUtils } from "../Utils/ChordUtils";
import { ColumnPatternUtils } from "../Utils/ColumnPatternUtils";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { FullChordJackEvaluator } from "./Jack/FullChordJackEvaluator";
import { JackSpacingEvaluator } from "./Jack/JackSpacingEvaluator";
import { SpeedjackEvaluator } from "./Jack/SpeedjackEvaluator";
import { TrillUtils } from "../Utils/TrillUtils";

const jack_multiplier = 0.9144;
export const JACK_WINDOW_MS = 350.0;

/** Generated from C# class JackEvaluator */
export const JackEvaluator = {
  JACK_WINDOW_MS,

  EvaluateDifficultyOf(current: ManiaDifficultyHitObject): number {
    const tap_rate_offset_ms = 60;
    const strain_exponent = 1.29407;
    let columnDelta = current.ColumnDelta;
    if ((columnDelta > JACK_WINDOW_MS)) {
      return 0.0;
    }
    let chordDepth = ChordUtils.DepthInChord(current);
    let tapRate = (1000.0 / ((Math.max(columnDelta, 1.0) + tap_rate_offset_ms)));
    const previousRow = current.Row.Previous();
    let sharesColumn = ((previousRow != null) && ColumnPatternUtils.SharesColumn(previousRow.Columns, current.Row.Columns));
    let jackDifficulty = (tapRate * JackEvaluator.calculateChordJackBonus(current, chordDepth, columnDelta));
    jackDifficulty = DiffUtils.Pow(jackDifficulty, strain_exponent);
    jackDifficulty *= JackEvaluator.calculateChordDepthMultiplier(current, chordDepth, columnDelta, sharesColumn);
    jackDifficulty *= JackEvaluator.calculateConcurrentHoldBonus(current);
    jackDifficulty *= FullChordJackEvaluator.EvaluateMultiplierOf(current, columnDelta, (jackDifficulty * jack_multiplier));
    jackDifficulty *= (((current.ManipulationFactor * current.EnduranceFactor) * SpeedjackEvaluator.EvaluateMultiplierOf(current)) * AnchorEvaluator.EvaluateMultiplierOf(current));
    jackDifficulty *= JackSpacingEvaluator.EvaluateMultiplierOf(current, chordDepth, columnDelta, tapRate);
    return JackEvaluator.speedCap((jackDifficulty * jack_multiplier));
  },

  calculateChordJackBonus(current: ManiaDifficultyHitObject, chordDepth: number, columnDelta: number): number {
    return Math.max(0.1, (((1.0 + ((0.05 * ChordUtils.ChordSpeedFactor(columnDelta)) * ((chordDepth - 1))))) * ChordUtils.ChordRepeatNerf(current, columnDelta)));
  },

  calculateChordDepthMultiplier(current: ManiaDifficultyHitObject, chordDepth: number, columnDelta: number, sharesColumn: boolean): number {
    const middle_ms = 100.0;
    const smoothness = 5.0;
    const midpoint = 1.8;
    const middle_value = 2.25;
    const saturation_ceiling = 2.75;
    const saturation_floor_ms = 10.0;
    const slowest_mult = 0.3;
    const same_shape_nerf = 0.6;
    if ((chordDepth < 2)) {
      return TrillUtils.TrillFactor(current);
    }
    let chordSpeedMultiplier = Math.max(slowest_mult, ((midpoint * smoothness) / ((((0.1 * columnDelta) - 11.0) + smoothness))));
    let speedShare = DiffUtils.Smoothstep(columnDelta, saturation_floor_ms, middle_ms);
    if ((speedShare < 1.0)) {
      chordSpeedMultiplier = (middle_value + (((saturation_ceiling - middle_value)) * ((1.0 - speedShare))));
    }
    chordSpeedMultiplier *= JackEvaluator.calculateHandRestMultiplier(current, sharesColumn);
    const previousShape = current.Row.Previous();
    if (((previousShape != null) && ColumnPatternUtils.SameColumns(previousShape.Columns, current.Row.Columns))) {
      chordSpeedMultiplier *= same_shape_nerf;
    }
    return (ChordUtils.CHORDJACK_NERF * chordSpeedMultiplier);
  },

  calculateHandRestMultiplier(current: ManiaDifficultyHitObject, sharesColumn: boolean): number {
    const empty_hand_nerf = 0.75;
    const no_shared_column_nerf = 0.9;
    let totalColumns = current.Row.TotalColumns;
    let columns = current.Row.Columns;
    const previous = current.Row.Previous();
    if (((previous != null) && (!sharesColumn))) {
      return no_shared_column_nerf;
    }
    let handSplit = (Math.trunc(totalColumns / 2));
    let leftPlayed = false;
    let rightPlayed = false;
    for (const column of columns) {
      if ((column < handSplit)) {
        leftPlayed = true;
      }
      else {
        rightPlayed = true;
      }
      if ((leftPlayed && rightPlayed)) {
        return 1.0;
      }
    }
    return empty_hand_nerf;
  },

  calculateConcurrentHoldBonus(current: ManiaDifficultyHitObject): number {
    const held_neighbour_weight = 0.7;
    const held_note_weight = 1.0;
    let totalColumns = current.PreviousHitObjects.length;
    if ((totalColumns == 1)) {
      return 1.0;
    }
    let heldNeighbours = 0;
    for (let offset = (-1); (offset <= 1); offset += 2) {
      let adjacentColumn = (current.Column + offset);
      if (((adjacentColumn < 0) || (adjacentColumn >= totalColumns))) {
        continue;
      }
      if ((Math.abs((current.LastStartTimeInColumn(adjacentColumn) - current.StartTime)) <= ChordUtils.CHORD_TOLERANCE_MS)) {
        continue;
      }
      if ((current.LastEndTimeInColumn(adjacentColumn) > (current.StartTime + ChordUtils.CHORD_TOLERANCE_MS))) {
        (heldNeighbours++);
      }
    }
    return (((1 + (heldNeighbours * held_neighbour_weight))) * ((1.0 + (held_note_weight * ((current.HeldNoteMultiplier - 1.0))))));
  },

  speedCap(value: number): number {
    const knee = 12.0;
    const past_knee_slope = 0.5;
    return ((value <= knee) ? value : (knee + (past_knee_slope * ((value - knee)))));
  },

};

export default JackEvaluator;
