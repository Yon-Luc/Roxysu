import type { BeatOnset } from "./types";

export type OnsetDetectionOptions = {
  frameSize?: number;
  hopSize?: number;
  minOnsetIntervalSec?: number;
  onsetThreshold?: number;
};

function frameEnergy(samples: Float32Array, start: number, size: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + size);
  for (let i = start; i < end; i += 1) {
    const s = samples[i]!;
    sum += s * s;
  }
  return sum / Math.max(1, end - start);
}

/** Detect onsets from mono PCM using spectral flux on frame energy. */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {},
): BeatOnset[] {
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? 512;
  const minIntervalMs = (options.minOnsetIntervalSec ?? 0.08) * 1000;
  const thresholdRatio = options.onsetThreshold ?? 0.35;

  if (samples.length < frameSize + hopSize) return [];

  const flux: number[] = [];
  let prevEnergy = frameEnergy(samples, 0, frameSize);

  for (let i = hopSize; i + frameSize <= samples.length; i += hopSize) {
    const energy = frameEnergy(samples, i, frameSize);
    flux.push(Math.max(0, energy - prevEnergy));
    prevEnergy = energy;
  }

  if (flux.length === 0) return [];

  const maxFlux = Math.max(...flux);
  if (maxFlux <= 0) return [];

  const threshold = maxFlux * thresholdRatio;
  const onsets: BeatOnset[] = [];
  let lastOnsetMs = -Infinity;

  for (let i = 1; i < flux.length - 1; i += 1) {
    const val = flux[i]!;
    if (val < threshold) continue;
    if (!(val >= flux[i - 1]! && val >= flux[i + 1]!)) continue;

    const timeMs = ((i * hopSize) / sampleRate) * 1000;
    if (timeMs - lastOnsetMs < minIntervalMs) {
      if (onsets.length > 0 && val > onsets[onsets.length - 1]!.strength) {
        onsets[onsets.length - 1] = { timeMs, strength: val / maxFlux };
        lastOnsetMs = timeMs;
      }
      continue;
    }

    onsets.push({ timeMs, strength: val / maxFlux });
    lastOnsetMs = timeMs;
  }

  return onsets;
}

/** Build a beat grid from estimated BPM, anchored at the first strong onset. */
export function buildBeatGrid(
  onsets: BeatOnset[],
  bpm: number,
  durationMs: number,
): BeatOnset[] {
  if (!Number.isFinite(bpm) || bpm <= 0 || durationMs <= 0) return [];

  const intervalMs = 60_000 / bpm;
  const anchor =
    onsets.find((o) => o.strength >= 0.5)?.timeMs ?? onsets[0]?.timeMs ?? 0;

  const beats: BeatOnset[] = [];
  let t = anchor;
  while (t < durationMs + intervalMs) {
    if (t >= 0) {
      beats.push({ timeMs: t, strength: 1 });
    }
    t += intervalMs;
  }
  return beats;
}
