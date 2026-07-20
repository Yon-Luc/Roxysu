export type BeatOnset = {
  timeMs: number;
  strength: number;
};

export type AudioSection = {
  startMs: number;
  endMs: number;
  energy: number;
};

export type AudioAnalysisResult = {
  algorithm: "audio-v1";
  durationMs: number;
  sampleRate: number;
  bpm: number | null;
  bpmConfidence: number;
  beats: BeatOnset[];
  onsets: BeatOnset[];
  sections: AudioSection[];
};

export type AudioAnalysisOptions = {
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
