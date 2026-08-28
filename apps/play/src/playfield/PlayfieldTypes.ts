export const NoteType = {
  Tap: 0,
  Hold: 1,
} as const;

export type NoteTypeValue = (typeof NoteType)[keyof typeof NoteType];

export interface PlayfieldRendererOptions {
  lanes: number;
  width: number;
  height: number;
  receptorY?: number;
  scrollSpeed?: number;
}

export interface PlayfieldChart {
  noteCount: number;
  startTime: Float64Array;
  endTime: Float64Array;
  lane: Uint8Array;
  type: Uint8Array;
}

export type PlayfieldColumnSnapshot = {
  x: number;
  w: number;
  tapHeight: number;
};

export type PlayfieldRenderSnapshot = {
  visibleCount: number;
  lane: Uint8Array;
  /** Head / tap center Y (mania note center line). */
  y: Float64Array;
  /** Hold tail center Y; equals `y` for tap notes. */
  holdEndCenterY: Float64Array;
  noteHeight: Float32Array;
  isHold: Uint8Array;
  alpha: Float32Array;
  /** Chart note index — stable key for retained GPU elements. */
  noteIndex: Uint32Array;
  lanes: number;
  width: number;
  playfieldHeight: number;
  receptorY: number;
  columns: readonly PlayfieldColumnSnapshot[];
  /** @deprecated Use `columns[lane].w` — kept for legacy callers. */
  laneWidth: number;
};
