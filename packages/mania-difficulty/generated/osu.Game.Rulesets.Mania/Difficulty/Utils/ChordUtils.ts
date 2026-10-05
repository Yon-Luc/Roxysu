// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../src/adapters/hitObject";
import { DiffUtils } from "../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { RunDampenUtils } from "./RunDampenUtils";

export const CHORD_TOLERANCE_MS = 8.0;
export const CHORDJACK_NERF = 0.45397;
export const DEFAULT_LOCAL_SIZE_RADIUS = 4;
const chord_speed_threshold_ms = 140.625;

/** Generated from C# class ChordUtils */
export const ChordUtils = {
  CHORD_TOLERANCE_MS,
  CHORDJACK_NERF,
  DEFAULT_LOCAL_SIZE_RADIUS,

  DepthInChord(current: ManiaDifficultyHitObject): number {
    return ((current.Index - current.Row.Objects[0].Index) + 1);
  },

  LocalChordSize(current: ManiaDifficultyHitObject, radius: number = DEFAULT_LOCAL_SIZE_RADIUS): number {
    let notes = 0.0;
    let rows = 0;
    for (const row of current.Row.RowsAround(radius)) {
      notes += row.Size;
      (rows++);
    }
    return ((rows > 0) ? (notes / rows) : 0.0);
  },

  ChordSpeedFactor(columnDelta: number): number {
    const factor_min = 0.1;
    const factor_max = 2.0;
    if (((columnDelta) === Number.POSITIVE_INFINITY)) {
      return 1.0;
    }
    return Math.min(Math.max((chord_speed_threshold_ms / columnDelta), factor_min), factor_max);
  },

  ChordRepeatNerf(current: ManiaDifficultyHitObject, columnDelta: number): number {
    const full_chord_nerf = 0.50;
    const full_chord_run_ramp = 2.0;
    const near_full_chord_nerf = 0.085;
    const near_full_chord_run_ramp = 12.0;
    let totalColumns = current.Row.TotalColumns;
    let speedScale = DiffUtils.ReverseLerp(columnDelta, 0.0, chord_speed_threshold_ms);
    let fullNerf = ((totalColumns >= 7) ? 0.68 : full_chord_nerf);
    let nearFullNerf = ((totalColumns >= 7) ? 0.15 : near_full_chord_nerf);
    let nerf = ChordUtils.chordRunNerf(current, totalColumns, (fullNerf * speedScale), full_chord_run_ramp);
    if ((totalColumns >= 2)) {
      nerf *= ChordUtils.chordRunNerf(current, (totalColumns - 1), (nearFullNerf * speedScale), near_full_chord_run_ramp);
    }
    return nerf;
  },

  chordRunNerf(current: ManiaDifficultyHitObject, minSize: number, ceiling: number, runRamp: number): number {
    if ((ceiling <= 0)) {
      return 1.0;
    }
    let cap = (RunDampenUtils.CapFor(runRamp) - 1);
    let run = 1;
    let row = current.Row;
    for (;;) {
      const earlier = row.Previous();
      if (!((((run <= cap) && (earlier != null)) && (earlier.Size >= minSize)))) break;
      (run++);
      row = earlier;
    }
    return RunDampenUtils.Dampen(run, runRamp, ceiling);
  },

};

export default ChordUtils;
