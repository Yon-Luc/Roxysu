import type { BeatOnset } from "./types";

const MIN_BPM = 60;
const MAX_BPM = 220;
/** Prefer tempi in this band when half/double are ambiguous (typical dance/pop BPM). */
const PREFERRED_BPM_CENTER = 128;
const PREFERRED_BPM_SIGMA = 42;

export type BpmEstimate = {
  bpm: number | null;
  confidence: number;
  /** Strong alternate candidates (usually half/double), excluding the chosen BPM. */
  alternates: number[];
};

function musicalWeight(bpm: number): number {
  const d = bpm - PREFERRED_BPM_CENTER;
  return Math.exp(-(d * d) / (2 * PREFERRED_BPM_SIGMA * PREFERRED_BPM_SIGMA));
}

/** Estimate tempo from onset IOIs using a histogram peak in BPM space. */
export function estimateBpm(onsets: BeatOnset[]): BpmEstimate {
  if (onsets.length < 4) {
    return { bpm: null, confidence: 0, alternates: [] };
  }

  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const ioi = onsets[i]!.timeMs - onsets[i - 1]!.timeMs;
    if (ioi >= 60_000 / MAX_BPM && ioi <= 60_000 / MIN_BPM) {
      iois.push(ioi);
    }
  }

  if (iois.length < 3) return { bpm: null, confidence: 0, alternates: [] };

  const bins = new Map<number, number>();
  for (const ioi of iois) {
    const bpm = Math.round(60_000 / ioi);
    for (const candidate of [bpm, Math.round(bpm / 2), Math.round(bpm * 2)]) {
      if (candidate < MIN_BPM || candidate > MAX_BPM) continue;
      bins.set(candidate, (bins.get(candidate) ?? 0) + 1);
    }
  }

  const ranked = [...bins.entries()]
    .map(([bpm, count]) => ({
      bpm,
      count,
      score: count * musicalWeight(bpm),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count);

  const best = ranked[0];
  if (!best || best.bpm <= 0) return { bpm: null, confidence: 0, alternates: [] };

  // Prefer double-tempo when the winner is unusually slow and half has similar support.
  let chosen = best;
  if (chosen.bpm < 85) {
    const doubled = ranked.find((r) => r.bpm === chosen.bpm * 2);
    if (doubled && doubled.count >= chosen.count * 0.55) {
      chosen = doubled;
    }
  } else if (chosen.bpm > 190) {
    const halved = ranked.find((r) => r.bpm === Math.round(chosen.bpm / 2));
    if (halved && halved.count >= chosen.count * 0.55) {
      chosen = halved;
    }
  }

  const confidence = Math.min(1, chosen.count / iois.length);
  const alternates = ranked
    .filter((r) => r.bpm !== chosen.bpm)
    .slice(0, 3)
    .map((r) => r.bpm);

  return { bpm: chosen.bpm, confidence, alternates };
}

/** Snap onsets to a regular beat grid and return downbeat-aligned beats. */
export function refineBeatsFromOnsets(
  onsets: BeatOnset[],
  bpm: number,
  durationMs: number,
): BeatOnset[] {
  if (!Number.isFinite(bpm) || bpm <= 0) return [];

  const intervalMs = 60_000 / bpm;
  const anchor = onsets[0]?.timeMs ?? 0;
  const beats: BeatOnset[] = [];

  for (let t = anchor; t <= durationMs + intervalMs; t += intervalMs) {
    if (t < 0) continue;

    let nearest: BeatOnset | null = null;
    let bestDist = Infinity;
    for (const onset of onsets) {
      const d = Math.abs(onset.timeMs - t);
      if (d < bestDist && d <= intervalMs * 0.45) {
        bestDist = d;
        nearest = onset;
      }
    }

    beats.push({
      timeMs: nearest?.timeMs ?? t,
      strength: nearest?.strength ?? 0.25,
    });
  }

  return beats;
}

/**
 * Pick a timing origin so charts start on the music, not at file t=0.
 * Uses the earliest beat in the first quarter of the track (or first onset).
 */
export function resolveTimingOffsetMs(
  beats: BeatOnset[],
  onsets: BeatOnset[],
  durationMs: number,
): number {
  const cutoff = Math.max(durationMs * 0.35, 15_000);
  const earlyBeats = beats.filter((b) => b.timeMs >= 0 && b.timeMs <= cutoff);
  if (earlyBeats.length > 0) {
    return Math.max(0, Math.round(earlyBeats[0]!.timeMs));
  }
  if (beats.length > 0) {
    return Math.max(0, Math.round(beats[0]!.timeMs));
  }
  const earlyOnsets = onsets.filter((o) => o.timeMs >= 0 && o.timeMs <= cutoff);
  if (earlyOnsets.length > 0) {
    return Math.max(0, Math.round(earlyOnsets[0]!.timeMs));
  }
  if (onsets.length > 0) {
    return Math.max(0, Math.round(onsets[0]!.timeMs));
  }
  return 0;
}
