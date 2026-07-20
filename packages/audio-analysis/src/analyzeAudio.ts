import { decodeAudioFile } from "./ffmpeg";
import {
  estimateBpm,
  refineBeatsFromOnsets,
  resolveTimingOffsetMs,
} from "./beats";
import { buildBeatGrid, detectOnsets } from "./onsets";
import { detectSections } from "./sections";
import type {
  AudioAnalysisOptions,
  AudioAnalysisResult,
  DecodedAudio,
} from "./types";

/** Analyze decoded PCM — no ffmpeg required. */
export function analyzeDecodedAudio(
  decoded: DecodedAudio,
  options: AudioAnalysisOptions = {},
): AudioAnalysisResult {
  const onsets = detectOnsets(decoded.samples, decoded.sampleRate, {
    frameSize: options.frameSize,
    hopSize: options.hopSize,
    minOnsetIntervalSec: options.minOnsetIntervalSec,
    onsetThreshold: options.onsetThreshold,
  });

  const { bpm, confidence, alternates } = estimateBpm(onsets);
  const beats =
    bpm != null
      ? refineBeatsFromOnsets(onsets, bpm, decoded.durationMs)
      : buildBeatGrid(onsets, 120, decoded.durationMs);

  const sections = detectSections(
    decoded.samples,
    decoded.sampleRate,
    options.sectionWindowSec ?? 8,
  );

  const timingOffsetMs = resolveTimingOffsetMs(
    beats,
    onsets,
    decoded.durationMs,
  );

  return {
    algorithm: "audio-v1",
    durationMs: decoded.durationMs,
    sampleRate: decoded.sampleRate,
    bpm,
    bpmConfidence: confidence,
    bpmAlternates: alternates,
    timingOffsetMs,
    beats,
    onsets,
    sections,
  };
}

/** Decode an audio file with ffmpeg and analyze beats/onsets. */
export async function analyzeAudioFile(
  filePath: string,
  options: AudioAnalysisOptions = {},
): Promise<AudioAnalysisResult> {
  const decoded = await decodeAudioFile(filePath, {
    ffmpegPath: options.ffmpegPath,
    sampleRate: options.sampleRate,
  });
  return analyzeDecodedAudio(decoded, options);
}

/** Synthesize a click track PCM buffer for tests (impulses every `intervalMs`). */
export function synthesizeImpulseTrack(
  intervalMs: number,
  count: number,
  sampleRate = 22_050,
): DecodedAudio {
  const totalMs = intervalMs * (count - 1) + 500;
  const samples = new Float32Array(Math.ceil((totalMs / 1000) * sampleRate));

  for (let i = 0; i < count; i += 1) {
    const idx = Math.round(((i * intervalMs) / 1000) * sampleRate);
    if (idx >= 0 && idx < samples.length) samples[idx] = 1;
  }

  return {
    samples,
    sampleRate,
    durationMs: (samples.length / sampleRate) * 1000,
  };
}
