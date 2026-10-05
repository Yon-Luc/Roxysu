// @generated from osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/JackSpacingEvaluator.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

import type { ManiaDifficultyHitObject } from "../../../../../src/adapters/hitObject";
import { ColumnPatternUtils } from "../../Utils/ColumnPatternUtils";
import { ColumnRunUtils } from "../../Utils/ColumnRunUtils";
import { DiffUtils } from "../../../../osu.Game/Rulesets/Difficulty/Utils/DiffUtils";

const context_radius = 6;

/** Generated from C# class JackSpacingEvaluator */
export const JackSpacingEvaluator = {
  EvaluateMultiplierOf(current: ManiaDifficultyHitObject, chordDepth: number, columnDelta: number, tapRate: number): number {
    let single = JackSpacingEvaluator.evaluateSingle(chordDepth, tapRate);
    let rowGap = JackSpacingEvaluator.rowGapOf(current);
    if ((rowGap <= 1.0)) {
      return single;
    }
    let rowsBetween = (columnDelta / rowGap);
    let rowSpacing = Math.max(JackSpacingEvaluator.evaluateIncidental(current, chordDepth, rowsBetween, columnDelta), JackSpacingEvaluator.evaluateHandstream(current, chordDepth, rowsBetween, columnDelta, rowGap));
    return Math.min(single, (1.0 - Math.max(rowSpacing, JackSpacingEvaluator.evaluateStray(current, columnDelta))));
  },

  evaluateSingle(chordDepth: number, tapRate: number): number {
    if ((chordDepth >= 2)) {
      return 1.0;
    }
    return (1.0 - (0.10 * DiffUtils.SmoothstepBellCurve(tapRate, 5.5, 0.7)));
  },

  evaluateIncidental(current: ManiaDifficultyHitObject, chordDepth: number, rowsBetween: number, columnDelta: number): number {
    if ((chordDepth >= 2)) {
      return 0.0;
    }
    let spacingGate = DiffUtils.Smoothstep(rowsBetween, 2.2, 3.2);
    if ((spacingGate <= 0.0)) {
      return 0.0;
    }
    let slowGate = DiffUtils.Smoothstep(columnDelta, 122, 150);
    let streamGate = DiffUtils.Smoothstep(JackSpacingEvaluator.singleNoteShare(current), 0.72, 0.90);
    return (((0.9 * spacingGate) * slowGate) * streamGate);
  },

  evaluateHandstream(current: ManiaDifficultyHitObject, chordDepth: number, rowsBetween: number, columnDelta: number, rowGap: number): number {
    let spacingGate = DiffUtils.Smoothstep(rowsBetween, 1.7, 2.6);
    if ((spacingGate <= 0.0)) {
      return 0.0;
    }
    let chordShare = ((chordDepth >= 2) ? 0.55 : 1.0);
    let slowGate = DiffUtils.Smoothstep(columnDelta, 122, 155);
    let streamGate = DiffUtils.Smoothstep(JackSpacingEvaluator.movedShare(current), 0.55, 0.80);
    let pulseGate = DiffUtils.Smoothstep(rowGap, 44, 58);
    return (((((0.70 * chordShare) * spacingGate) * slowGate) * streamGate) * pulseGate);
  },

  evaluateStray(current: ManiaDifficultyHitObject, columnDelta: number): number {
    let noteGap = current.DeltaTime;
    if ((noteGap <= 1.0)) {
      return 0.0;
    }
    let notesBetween = (columnDelta / noteGap);
    let spacingGate = DiffUtils.Smoothstep(notesBetween, 2.2, 1.5);
    if ((spacingGate <= 0.0)) {
      return 0.0;
    }
    let speedGate = DiffUtils.Smoothstep(columnDelta, 78, 90);
    if ((speedGate <= 0.0)) {
      return 0.0;
    }
    const __decon = JackSpacingEvaluator.chordContext(current);
    const chordShare = (__decon as any).chordShare;
    const repeatShare = (__decon as any).repeatShare;
    let chordSpare = (DiffUtils.Smoothstep(chordShare, 0.50, 0.78) * DiffUtils.Smoothstep(repeatShare, 0.55, 0.25));
    let anchorSpare = DiffUtils.Smoothstep(ColumnRunUtils.RunLengthAround(current, 130), 3, 6);
    return ((((0.45 * spacingGate) * speedGate) * ((1.0 - chordSpare))) * ((1.0 - anchorSpare)));
  },

  rowGapOf(current: ManiaDifficultyHitObject): number {
    let previousRow = current.Row.Previous();
    return ((previousRow != null) ? (current.Row.StartTime - previousRow.StartTime) : current.DeltaTime);
  },

  singleNoteShare(current: ManiaDifficultyHitObject): number {
    let singleNoteRows = 0;
    let rows = 0;
    for (const row of current.Row.RowsAround(context_radius)) {
      (rows++);
      if (row.IsSingleNote) {
        (singleNoteRows++);
      }
    }
    return ((rows > 0) ? (Number(singleNoteRows) / rows) : 0.0);
  },

  movedShare(current: ManiaDifficultyHitObject): number {
    let movedRows = 0;
    let rows = 0;
    for (const row of current.Row.RowsAround(context_radius)) {
      const previous = row.Previous();
      if ((previous == null)) {
        continue;
      }
      (rows++);
      if ((!ColumnPatternUtils.SharesColumn(row.Columns, previous.Columns))) {
        (movedRows++);
      }
    }
    return ((rows > 0) ? (Number(movedRows) / rows) : 0.0);
  },

  chordContext(current: ManiaDifficultyHitObject): { chordShare: number; repeatShare: number } {
    let rows = 0;
    let chordRows = 0;
    let repeatedChordRows = 0;
    for (const row of current.Row.RowsAround(context_radius)) {
      (rows++);
      if ((row.Size < 3)) {
        continue;
      }
      (chordRows++);
      const previous = row.Previous();
      if (((previous != null) && ColumnPatternUtils.SameColumns(previous.Columns, row.Columns))) {
        (repeatedChordRows++);
      }
    }
    let chordShare = ((rows > 0) ? (Number(chordRows) / rows) : 0.0);
    let repeatShare = ((chordRows > 0) ? (Number(repeatedChordRows) / chordRows) : 0.0);
    return { chordShare: chordShare, repeatShare: repeatShare };
  },

};

export default JackSpacingEvaluator;
