export type BeatOnset = {
  timeMs: number;
  strength: number;
};

export type AudioSection = {
  startMs: number;
  endMs: number;
  energy: number;
};

/** A stretch of constant tempo detected from audio. */
export type TempoSegment = {
  startMs: number;
  endMs: number;
  bpm: number;
  beatLengthMs: number;
  confidence: number;
};

export type AudioAnalysisResult = {
  algorithm: "audio-v1" | "audio-v2";
  durationMs: number;
  sampleRate: number;
  /** Dominant / global BPM (mode of the tempo map). */
  bpm: number | null;
  bpmConfidence: number;
  /** Other plausible tempi (half/double), excluding `bpm`. */
  bpmAlternates: number[];
  /** Suggested chart offset — first musical beat, not always 0. */
  timingOffsetMs: number;
  /** Piecewise tempo — empty/single when the track is constant-BPM. */
  tempoMap: TempoSegment[];
  /** Uninherited timing points derived from `tempoMap` + offset. */
  timingPoints: Array<[number, number]>;
  beats: BeatOnset[];
  onsets: BeatOnset[];
  sections: AudioSection[];
};

export type AudioAnalysisOptions = {
  /** Analysis recipe. Default: "audio-v1". */
  algorithm?: "audio-v1" | "audio-v2";
  /** Path to ffmpeg binary. Default: "ffmpeg". */
  ffmpegPath?: string;
  /** Decode sample rate. Default: 22050. */
  sampleRate?: number;
  /** Onset detection frame size in samples. Default: 1024. */
  frameSize?: number;
  /** Hop size between frames. Default: 512. */
  hopSize?: number;
  /** Minimum seconds between detected onsets. Default: 0.08. */
  minOnsetIntervalSec?: number;
  /** Relative threshold for onset peaks (0–1 of max flux). Default: 0.35. */
  onsetThreshold?: number;
  /** Section window length in seconds. Default: 8. */
  sectionWindowSec?: number;
  /** audio-v2: merge adjacent onsets closer than this beat fraction. Default: 1/6. */
  minPlacementGapBeats?: number;
};

export type DecodeAudioOptions = {
  ffmpegPath?: string;
  sampleRate?: number;
};

export type DecodedAudio = {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
};
