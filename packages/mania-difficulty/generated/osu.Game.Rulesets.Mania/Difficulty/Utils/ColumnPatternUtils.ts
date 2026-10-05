// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate


/** Generated from C# class ColumnPatternUtils */
export const ColumnPatternUtils = {
  SameColumns(a: number[], b: number[]): boolean {
    if ((a.length != b.length)) {
      return false;
    }
    for (let i = 0; (i < a.length); (i++)) {
      if ((a[i] != b[i])) {
        return false;
      }
    }
    return true;
  },

  SharesColumn(a: number[], b: number[]): boolean {
    return (ColumnPatternUtils.SharedColumnCount(a, b) > 0);
  },

  SharedColumnCount(a: number[], b: number[]): number {
    let i = 0;
    let j = 0;
    let shared = 0;
    while (((i < a.length) && (j < b.length))) {
      if ((a[i] == b[j])) {
        (shared++);
        (i++);
        (j++);
      }
      else {
        if ((a[i] < b[j])) {
          (i++);
        }
        else {
          (j++);
        }
      }
    }
    return shared;
  },

  IsRoll(from: number[], to: number[]): boolean {
    return (ColumnPatternUtils.ColumnShift(from, to) != 0);
  },

  IsRecurrence(first: number[], between: number[], last: number[]): boolean {
    return (ColumnPatternUtils.SameColumns(last, first) && (!ColumnPatternUtils.SameColumns(last, between)));
  },

  ColumnShift(a: number[], b: number[]): number {
    if (((a.length != b.length) || (a.length == 0))) {
      return 0;
    }
    let k = (b[0] - a[0]);
    if (((k == 0) || (Math.abs(k) > 1))) {
      return 0;
    }
    for (let i = 1; (i < a.length); (i++)) {
      if (((b[i] - a[i]) != k)) {
        return 0;
      }
    }
    return k;
  },

  ChordDifference(a: number[], b: number[]): number {
    let i = 0;
    let j = 0;
    let shared = 0;
    while (((i < a.length) && (j < b.length))) {
      if ((a[i] == b[j])) {
        (shared++);
        (i++);
        (j++);
      }
      else {
        if ((a[i] < b[j])) {
          (i++);
        }
        else {
          (j++);
        }
      }
    }
    let union = ((a.length + b.length) - shared);
    return ((union == 0) ? 0.0 : (1.0 - (Number(shared) / union)));
  },

};

export default ColumnPatternUtils;
