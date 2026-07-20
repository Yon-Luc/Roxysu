import type { BeatOnset } from "./types";

const MIN_BPM = 60;
const MAX_BPM = 220;

/** Estimate tempo from onset IOIs using a histogram peak in BPM space. */
export function estimateBpm(
  onsets: BeatOnset[],
): { bpm: number | null; confidence: number } {
  if (onsets.length < 4) {
    return { bpm: null, confidence: 0 };
  }

  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const ioi = onsets[i]!.timeMs - onsets[i - 1]!.timeMs;
    if (ioi >= 60_000 / MAX_BPM && ioi <= 60_000 / MIN_BPM) {
      iois.push(ioi);
    }
  }

  if (iois.length < 3) return { bpm: null, confidence: 0 };

  const bins = new Map<number, number>();
  for (const ioi of iois) {
    const bpm = Math.round(60_000 / ioi);
    for (const candidate of [bpm, Math.round(bpm / 2), Math.round(bpm * 2)]) {
      if (candidate < MIN_BPM || candidate > MAX_BPM) continue;
      bins.set(candidate, (bins.get(candidate) ?? 0) + 1);
    }
  }

  let bestBpm = 0;
  let bestCount = 0;
  for (const [bpm, count] of bins) {
    if (count > bestCount) {
      bestBpm = bpm;
      bestCount = count;
    }
  }

  if (bestBpm <= 0) return { bpm: null, confidence: 0 };

  const confidence = Math.min(1, bestCount / iois.length);
  return { bpm: bestBpm, confidence };
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
