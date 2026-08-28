export const NoteType = {
  Tap: 0,
  Hold: 1,
} as const;

export type NoteTypeValue = (typeof NoteType)[keyof typeof NoteType];

export type BeatmapChart = {
  columnCount: number;
  overallDifficulty: number;
  noteCount: number;
  column: Uint8Array;
  startMs: Float64Array;
  endMs: Float64Array;
  type: Uint8Array;
};

export function createBeatmapChart(args: {
  columnCount: number;
  overallDifficulty: number;
  column: Uint8Array;
  startMs: Float64Array;
  endMs: Float64Array;
  type: Uint8Array;
}): BeatmapChart {
  return {
    columnCount: args.columnCount,
    overallDifficulty: args.overallDifficulty,
    noteCount: args.startMs.length,
    column: args.column,
    startMs: args.startMs,
    endMs: args.endMs,
    type: args.type,
  };
}
