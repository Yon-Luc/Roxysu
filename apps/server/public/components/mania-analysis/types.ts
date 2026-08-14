export type ManiaDensitySampleView = {
  startMs: number;
  endMs: number;
  midpointMs: number;
  noteCount: number;
  notesPerSecond: number;
  peakChordSize: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  composition: Record<string, number>;
};

export type ManiaHotspotView = {
  startMs: number;
  endMs: number;
  noteCount: number;
  notesPerSecond: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  dominantCoverage: number;
};

export type ManiaPatternDetailView = {
  algorithm: string;
  columnCount: number | null;
  noteCount: number;
  holdCount: number;
  durationMs: number;
  averageNps: number;
  peakNps: number;
  peakChordSize: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  confidence: number | null;
  composition: Record<string, number>;
  samples: ManiaDensitySampleView[];
  hotspots: ManiaHotspotView[];
  error: string | null;
};
