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

export type PlayfieldRenderSnapshot = {
  visibleCount: number;
  lane: Uint8Array;
  y: Float64Array;
  noteHeight: Float32Array;
  alpha: Float32Array;
  lanes: number;
  width: number;
  playfieldHeight: number;
  receptorY: number;
  laneWidth: number;
};
