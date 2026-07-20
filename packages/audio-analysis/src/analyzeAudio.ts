import { decodeAudioFile } from "./ffmpeg";
import {
  estimateBpm,
  refineBeatsFromOnsets,
  resolveTimingOffsetMs,
} from "./beats";
import { buildBeatGrid, detectOnsets } from "./onsets";
import { detectSections } from "./sections";
import {
  estimateTempoMap,
  refineBeatsFromTempoMap,
  tempoMapToTimingPoints,
} from "./tempoMap";
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
  const tempoMap = estimateTempoMap(
    onsets,
    decoded.durationMs,
    bpm,
    confidence,
  );

  const beats =
    tempoMap.length > 1
      ? refineBeatsFromTempoMap(onsets, tempoMap, decoded.durationMs)
      : bpm != null
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

  const timingPoints = tempoMapToTimingPoints(tempoMap, timingOffsetMs);

  return {
    algorithm: "audio-v1",
    durationMs: decoded.durationMs,
    sampleRate: decoded.sampleRate,
    bpm,
    bpmConfidence: confidence,
    bpmAlternates: alternates,
    timingOffsetMs,
    tempoMap,
    timingPoints,
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

/**
 * Two-tempo click track for tempo-map tests.
 * First half uses `intervalAMs`, second half uses `intervalBMs`.
 */
export function synthesizeTwoTempoTrack(
  intervalAMs: number,
  countA: number,
  intervalBMs: number,
  countB: number,
  sampleRate = 22_050,
): DecodedAudio {
  const switchMs = intervalAMs * (countA - 1);
  const totalMs = switchMs + intervalBMs * (countB - 1) + 500;
  const samples = new Float32Array(Math.ceil((totalMs / 1000) * sampleRate));

  for (let i = 0; i < countA; i += 1) {
    const t = i * intervalAMs;
    const idx = Math.round((t / 1000) * sampleRate);
    if (idx >= 0 && idx < samples.length) samples[idx] = 1;
  }
  for (let i = 0; i < countB; i += 1) {
    const t = switchMs + i * intervalBMs;
    const idx = Math.round((t / 1000) * sampleRate);
    if (idx >= 0 && idx < samples.length) samples[idx] = 1;
  }

  return {
    samples,
    sampleRate,
    durationMs: (samples.length / sampleRate) * 1000,
  };
}
