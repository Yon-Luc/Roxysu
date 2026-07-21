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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function mergeNearbyOnsets(
  onsets: AudioAnalysisResult["onsets"],
  bpm: number | null,
  beatWindow = 1 / 6,
): AudioAnalysisResult["onsets"] {
  if (onsets.length <= 1 || !bpm || bpm <= 0) return onsets;
  const minGapMs = (60_000 / bpm) * beatWindow;
  const merged: AudioAnalysisResult["onsets"] = [onsets[0]!];
  for (let i = 1; i < onsets.length; i += 1) {
    const next = onsets[i]!;
    const prev = merged[merged.length - 1]!;
    if (next.timeMs - prev.timeMs < minGapMs) {
      if (next.strength > prev.strength) merged[merged.length - 1] = next;
      continue;
    }
    merged.push(next);
  }
  return merged;
}

function analyzeWindow(
  decoded: DecodedAudio,
  startRatio: number,
  endRatio: number,
  options: AudioAnalysisOptions,
): { bpm: number | null; offset: number; confidence: number } {
  const total = decoded.samples.length;
  const start = Math.max(0, Math.floor(total * startRatio));
  const end = Math.min(total, Math.floor(total * endRatio));
  const sliced: DecodedAudio = {
    samples: decoded.samples.slice(start, end),
    sampleRate: decoded.sampleRate,
    durationMs: ((end - start) / decoded.sampleRate) * 1000,
  };
  const result = analyzeDecodedAudio(sliced, { ...options, algorithm: "audio-v1" });
  const startMs = (start / decoded.sampleRate) * 1000;
  return {
    bpm: result.bpm,
    offset: result.timingOffsetMs + startMs,
    confidence: result.bpmConfidence,
  };
}

/** Analyze decoded PCM — no ffmpeg required. */
export function analyzeDecodedAudio(
  decoded: DecodedAudio,
  options: AudioAnalysisOptions = {},
): AudioAnalysisResult {
  const algorithm = options.algorithm ?? "audio-v1";
  const baseOnsets = detectOnsets(decoded.samples, decoded.sampleRate, {
    frameSize: options.frameSize,
    hopSize: options.hopSize,
    minOnsetIntervalSec: options.minOnsetIntervalSec,
    onsetThreshold: options.onsetThreshold,
  });

  const { bpm: rawBpm, confidence: rawConfidence, alternates } = estimateBpm(baseOnsets);
  const onsets =
    algorithm === "audio-v2"
      ? mergeNearbyOnsets(baseOnsets, rawBpm, options.minPlacementGapBeats ?? 1 / 6)
      : baseOnsets;
  const { bpm, confidence } =
    algorithm === "audio-v2"
      ? estimateBpm(onsets)
      : { bpm: rawBpm, confidence: rawConfidence };
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

  let timingOffsetMs = resolveTimingOffsetMs(
    beats,
    onsets,
    decoded.durationMs,
  );

  if (algorithm === "audio-v2") {
    const windows = [
      analyzeWindow(decoded, 0, 0.35, options),
      analyzeWindow(decoded, 0.25, 0.6, options),
      analyzeWindow(decoded, 0.5, 0.85, options),
    ].filter((window) => window.confidence > 0.1);
    const bpms = windows
      .map((window) => window.bpm)
      .filter((value): value is number => value != null && value > 0);
    const offsets = windows.map((window) => window.offset).filter(Number.isFinite);
    if (bpms.length > 0) {
      const mergedBpm = median(bpms);
      if (Number.isFinite(mergedBpm) && mergedBpm > 0) {
        const remapped = estimateTempoMap(onsets, decoded.durationMs, mergedBpm, confidence);
        if (remapped.length > 0) {
          tempoMap.splice(0, tempoMap.length, ...remapped);
        }
      }
    }
    if (offsets.length > 0) timingOffsetMs = Math.round(median(offsets));
  }

  const timingPoints = tempoMapToTimingPoints(tempoMap, timingOffsetMs);

  return {
    algorithm,
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
