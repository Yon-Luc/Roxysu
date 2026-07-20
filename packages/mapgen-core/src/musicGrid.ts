import type { AudioAnalysisResult, BeatOnset } from "@roxysu/audio-analysis";

function beatLengthAt(
  timingPoints: Array<[number, number]>,
  timeMs: number,
): number {
  if (timingPoints.length === 0) return 500;
  let active = timingPoints[0]![1];
  for (const [t, beatLen] of timingPoints) {
    if (t > timeMs) break;
    active = beatLen;
  }
  return active;
}

function timingOriginAt(
  timingPoints: Array<[number, number]>,
  timeMs: number,
): { originMs: number; beatLengthMs: number } {
  if (timingPoints.length === 0) {
    return { originMs: 0, beatLengthMs: 500 };
  }
  let originMs = timingPoints[0]![0];
  let beatLengthMs = timingPoints[0]![1];
  for (const [t, beatLen] of timingPoints) {
    if (t > timeMs) break;
    originMs = t;
    beatLengthMs = beatLen;
  }
  return { originMs, beatLengthMs };
}

function quantizeToSnap(
  timeMs: number,
  timingPoints: Array<[number, number]>,
  snapDivisor: number,
): number {
  const { originMs, beatLengthMs } = timingOriginAt(timingPoints, timeMs);
  const snapMs = beatLengthMs / Math.max(1, snapDivisor);
  if (snapMs <= 0) return Math.round(timeMs);
  const n = Math.round((timeMs - originMs) / snapMs);
  return Math.round(originMs + n * snapMs);
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

function sectionEnergyAt(
  sections: AudioAnalysisResult["sections"],
  timeMs: number,
): number {
  if (sections.length === 0) return 1;
  for (const s of sections) {
    if (timeMs >= s.startMs && timeMs < s.endMs) return s.energy;
  }
  return sections[sections.length - 1]!.energy;
}

export type MusicalGridOptions = {
  snapDivisor: number;
  /** Keep onsets at/above this strength quantile (0–1). */
  onsetKeepQuantile: number;
  /** Max distance from an onset/beat to accept a snapped hit. */
  maxSnapDistanceMs?: number;
};

/**
 * Build snapped musical hit times from audio onsets (+ beats as fallback).
 * RC guideline: every note should correlate to a sound in the music.
 */
export function buildMusicalHitTimes(
  audio: AudioAnalysisResult,
  timingPoints: Array<[number, number]>,
  startMs: number,
  endMs: number,
  options: MusicalGridOptions,
): number[] {
  const maxDist = options.maxSnapDistanceMs ?? 45;
  const snapDivisor = Math.max(1, options.snapDivisor);

  const candidates: BeatOnset[] = [];
  for (const o of audio.onsets) {
    if (o.timeMs < startMs - 50 || o.timeMs > endMs + 50) continue;
    candidates.push(o);
  }
  // Beats fill sparse regions so we don't go silent when onset detection is weak.
  for (const b of audio.beats) {
    if (b.timeMs < startMs - 50 || b.timeMs > endMs + 50) continue;
    candidates.push({ timeMs: b.timeMs, strength: b.strength * 0.55 });
  }

  if (candidates.length === 0) {
    // Last resort: regular beat grid from timing points.
    const fallback: number[] = [];
    let t = startMs;
    while (t < endMs) {
      fallback.push(Math.round(t));
      t += beatLengthAt(timingPoints, t);
    }
    return fallback;
  }

  const strengths = candidates.map((c) => c.strength);
  const strengthFloor = quantile(strengths, options.onsetKeepQuantile);

  // Section energy: in quiet sections raise the bar further.
  const energies = audio.sections.map((s) => s.energy);
  const energyMedian =
    energies.length > 0 ? quantile(energies, 0.5) : 1;

  const snapped = new Map<number, number>(); // time → best strength
  for (const c of candidates) {
    const energy = sectionEnergyAt(audio.sections, c.timeMs);
    const localFloor =
      energy < energyMedian * 0.65
        ? Math.max(strengthFloor, quantile(strengths, Math.min(0.85, options.onsetKeepQuantile + 0.2)))
        : strengthFloor;
    if (c.strength < localFloor * 0.85 && c.strength < strengthFloor) continue;

    const q = quantizeToSnap(c.timeMs, timingPoints, snapDivisor);
    if (q < startMs - 1 || q >= endMs) continue;
    if (Math.abs(q - c.timeMs) > maxDist) continue;

    const prev = snapped.get(q);
    if (prev == null || c.strength > prev) snapped.set(q, c.strength);
  }

  const times = [...snapped.keys()].sort((a, b) => a - b);
  if (times.length >= 4) return times;

  // Too sparse — relax to beat grid snapped hits.
  const relaxed: number[] = [];
  for (const b of audio.beats) {
    if (b.timeMs < startMs || b.timeMs >= endMs) continue;
    const q = quantizeToSnap(b.timeMs, timingPoints, Math.min(4, snapDivisor));
    if (q >= startMs && q < endMs) relaxed.push(q);
  }
  return [...new Set(relaxed)].sort((a, b) => a - b);
}
