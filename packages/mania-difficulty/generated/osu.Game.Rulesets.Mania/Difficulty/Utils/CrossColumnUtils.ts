// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/CrossColumnUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

const boundary_multipliers_per_column = [ [ 0.075, 0.075 ], [ 0.125, 0.05, 0.125 ], [ 0.125, 0.125, 0.125, 0.125 ], [ 0.175, 0.25, 0.05, 0.25, 0.175 ], [ 0.175, 0.25, 0.175, 0.175, 0.25, 0.175 ], [ 0.225, 0.35, 0.25, 0.05, 0.25, 0.35, 0.225 ], [ 0.225, 0.35, 0.25, 0.225, 0.225, 0.25, 0.35, 0.225 ], [ 0.275, 0.45, 0.35, 0.25, 0.05, 0.25, 0.35, 0.45, 0.275 ], [ 0.275, 0.45, 0.35, 0.25, 0.275, 0.275, 0.25, 0.35, 0.45, 0.275 ], [ 0.325, 0.55, 0.45, 0.35, 0.25, 0.05, 0.25, 0.35, 0.45, 0.55, 0.325 ] ];

/** Generated from C# class CrossColumnUtils */
export const CrossColumnUtils = {
  SumBoundaryMultipliersBetween(columnA: number, columnB: number, totalColumns: number): number {
    let coefficients = CrossColumnUtils.multipliersFor(totalColumns);
    let lowColumn = Math.min(columnA, columnB);
    let highColumn = Math.max(columnA, columnB);
    let sum = 0.0;
    for (let boundary = (lowColumn + 1); ((boundary <= highColumn) && (boundary < coefficients.length)); (boundary++)) {
      sum += coefficients[boundary];
    }
    return sum;
  },

  ColumnBoundaryMultiplier(boundaryIndex: number, totalColumns: number): number {
    let coefficients = CrossColumnUtils.multipliersFor(totalColumns);
    return (((boundaryIndex >= 0) && (boundaryIndex < coefficients.length)) ? coefficients[boundaryIndex] : 0.0);
  },

  AverageBoundaryMultipliersBetween(columnA: number, columnB: number, totalColumns: number): number {
    let span = Math.abs((columnA - columnB));
    if ((span <= 0)) {
      return 0.0;
    }
    return ((CrossColumnUtils.SumBoundaryMultipliersBetween(columnA, columnB, totalColumns) / span) * Math.sqrt(span));
  },

  multipliersFor(totalColumns: number): number[] {
    return (((totalColumns >= 1) && (totalColumns <= boundary_multipliers_per_column.length)) ? boundary_multipliers_per_column[(totalColumns - 1)] : CrossColumnUtils.fallbackBoundaryMultipliers(totalColumns));
  },

  fallbackBoundaryMultipliers(keyCount: number): number[] {
    let fallback = Array.from({ length: (keyCount + 1) }, () => 0);
    for (let i = 0; (i < fallback.length); (i++)) {
      fallback[i] = (1.0 / fallback.length);
    }
    return fallback;
  },

};

export default CrossColumnUtils;
