import { estimateBpm, refineBeatsFromOnsets } from "./beats";
import type { BeatOnset, TempoSegment } from "./types";

export type TempoMapOptions = {
  /** Analysis window length. Default: 20s. */
  windowMs?: number;
  /** Hop between windows. Default: 10s. */
  hopMs?: number;
  /** Relative BPM change required to start a new segment. Default: 0.12 (12%). */
  minChangeRatio?: number;
  /** Absolute BPM delta that always counts as a change. Default: 10. */
  minChangeBpm?: number;
  /** Minimum segment length before allowing another change. Default: 16s. */
  minSegmentMs?: number;
  /** Minimum local BPM confidence to trust a window. Default: 0.35. */
  minWindowConfidence?: number;
  /**
   * If the global BPM estimate is below this confidence, skip multi-tempo
   * detection entirely (too noisy). Default: 0.28.
   */
  minGlobalConfidenceForMap?: number;
};

function bpmClose(
  a: number,
  b: number,
  minChangeRatio: number,
  minChangeBpm: number,
): boolean {
  const abs = Math.abs(a - b);
  if (abs < minChangeBpm) return true;
  const rel = abs / Math.max(a, b);
  return rel < minChangeRatio;
}

/** Align half/double mistakes toward a reference BPM when clearly related. */
function alignToReference(bpm: number, reference: number): number {
  const candidates = [bpm, bpm * 2, bpm / 2, bpm * 3, bpm / 3];
  let best = bpm;
  let bestDist = Math.abs(bpm - reference);
  for (const c of candidates) {
    if (c < 60 || c > 220) continue;
    const d = Math.abs(c - reference);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  if (bestDist / reference <= 0.06) return Math.round(best);
  return Math.round(bpm);
}

function onsetsInRange(
  onsets: BeatOnset[],
  startMs: number,
  endMs: number,
): BeatOnset[] {
  return onsets.filter((o) => o.timeMs >= startMs && o.timeMs < endMs);
}

function singleSegment(
  durationMs: number,
  bpm: number,
  confidence: number,
): TempoSegment[] {
  return [
    {
      startMs: 0,
      endMs: durationMs,
      bpm,
      beatLengthMs: 60_000 / bpm,
      confidence,
    },
  ];
}

type WindowEstimate = {
  startMs: number;
  endMs: number;
  bpm: number;
  confidence: number;
};

/**
 * Estimate a piecewise tempo map from onsets.
 * Conservative by default — prefers a single global BPM unless windows show a
 * clear, sustained tempo change.
 */
export function estimateTempoMap(
  onsets: BeatOnset[],
  durationMs: number,
  globalBpm: number | null,
  globalConfidence = 0.5,
  options: TempoMapOptions = {},
): TempoSegment[] {
  const windowMs = options.windowMs ?? 20_000;
  const hopMs = options.hopMs ?? 10_000;
  const minChangeRatio = options.minChangeRatio ?? 0.12;
  const minChangeBpm = options.minChangeBpm ?? 10;
  const minSegmentMs = options.minSegmentMs ?? 16_000;
  const minWindowConfidence = options.minWindowConfidence ?? 0.35;
  const minGlobalConfidenceForMap =
    options.minGlobalConfidenceForMap ?? 0.28;

  const fallbackBpm = globalBpm && globalBpm > 0 ? globalBpm : 120;

  // Low global confidence → don't invent a tempo map from noise.
  if (
    onsets.length < 16 ||
    durationMs < windowMs ||
    globalConfidence < minGlobalConfidenceForMap
  ) {
    return singleSegment(
      durationMs,
      fallbackBpm,
      globalBpm != null ? globalConfidence : 0.1,
    );
  }

  const windows: WindowEstimate[] = [];
  for (let start = 0; start < durationMs; start += hopMs) {
    const end = Math.min(durationMs, start + windowMs);
    const local = onsetsInRange(onsets, start, end);
    if (local.length < 8) continue;
    const est = estimateBpm(local);
    if (est.bpm == null || est.confidence < minWindowConfidence) continue;

    const bpm = globalBpm
      ? alignToReference(est.bpm, globalBpm)
      : est.bpm;

    windows.push({
      startMs: start,
      endMs: end,
      bpm,
      confidence: est.confidence,
    });
  }

  if (windows.length < 3) {
    return singleSegment(durationMs, fallbackBpm, globalConfidence);
  }

  // How often do windows disagree with the global BPM?
  const disagree = windows.filter(
    (w) => !bpmClose(w.bpm, fallbackBpm, minChangeRatio, minChangeBpm),
  );
  // Need a sustained minority of clear alternate tempo, not random flicker.
  if (disagree.length < 2) {
    return singleSegment(durationMs, fallbackBpm, globalConfidence);
  }

  type RawSeg = {
    startMs: number;
    endMs: number;
    bpmSum: number;
    confSum: number;
    weight: number;
  };

  const raw: RawSeg[] = [];
  for (const w of windows) {
    const last = raw[raw.length - 1];
    const lastBpm = last ? last.bpmSum / last.weight : 0;
    if (
      last &&
      bpmClose(w.bpm, lastBpm, minChangeRatio, minChangeBpm)
    ) {
      last.endMs = Math.max(last.endMs, w.endMs);
      last.bpmSum += w.bpm * w.confidence;
      last.confSum += w.confidence;
      last.weight += w.confidence;
    } else if (last && w.startMs - last.startMs < minSegmentMs) {
      // Too soon for a change — fold into previous, keep prior tempo dominant.
      last.endMs = Math.max(last.endMs, w.endMs);
      const wWeight = w.confidence * 0.2;
      last.bpmSum += lastBpm * wWeight;
      last.confSum += wWeight;
      last.weight += wWeight;
    } else {
      raw.push({
        startMs: w.startMs,
        endMs: w.endMs,
        bpmSum: w.bpm * w.confidence,
        confSum: w.confidence,
        weight: w.confidence,
      });
    }
  }

  const segments: TempoSegment[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const seg = raw[i]!;
    const startMs =
      i === 0 ? 0 : snapBoundary(onsets, segments[i - 1]!.endMs, seg.startMs);
    const endMs =
      i === raw.length - 1
        ? durationMs
        : snapBoundary(
            onsets,
            seg.endMs,
            (raw[i + 1]!.startMs + raw[i + 1]!.endMs) / 2,
          );

    const bpm = Math.round(seg.bpmSum / Math.max(1e-6, seg.weight));
    const confidence = Math.min(1, seg.confSum / Math.max(1, seg.weight));

    if (
      segments.length > 0 &&
      (endMs - startMs < minSegmentMs * 0.5 ||
        bpmClose(
          bpm,
          segments[segments.length - 1]!.bpm,
          minChangeRatio,
          minChangeBpm,
        ))
    ) {
      segments[segments.length - 1]!.endMs = endMs;
      continue;
    }

    segments.push({
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
      bpm,
      beatLengthMs: 60_000 / bpm,
      confidence,
    });
  }

  if (segments.length === 0) {
    return singleSegment(durationMs, fallbackBpm, globalConfidence);
  }

  // Too many segments usually means noise, not real tempo changes.
  if (segments.length > 4) {
    return singleSegment(durationMs, fallbackBpm, globalConfidence);
  }

  segments[0]!.startMs = 0;
  segments[segments.length - 1]!.endMs = durationMs;
  for (let i = 1; i < segments.length; i += 1) {
    segments[i]!.startMs = segments[i - 1]!.endMs;
  }

  return segments;
}

function snapBoundary(
  onsets: BeatOnset[],
  approxMs: number,
  hintMs: number,
): number {
  const target = (approxMs + hintMs) / 2;
  let best = target;
  let bestDist = Infinity;
  for (const o of onsets) {
    const d = Math.abs(o.timeMs - target);
    if (d < bestDist && d < 750) {
      bestDist = d;
      best = o.timeMs;
    }
  }
  return best;
}

/** Build a beat grid that respects per-segment tempi. */
export function refineBeatsFromTempoMap(
  onsets: BeatOnset[],
  segments: TempoSegment[],
  durationMs: number,
): BeatOnset[] {
  if (segments.length === 0) return [];

  const beats: BeatOnset[] = [];
  for (const seg of segments) {
    const localOnsets = onsetsInRange(onsets, seg.startMs, seg.endMs);
    const seed =
      localOnsets.length >= 4
        ? localOnsets
        : onsetsInRange(
            onsets,
            Math.max(0, seg.startMs - 2000),
            Math.min(durationMs, seg.endMs + 2000),
          );

    const localBeats = refineBeatsFromOnsets(
      seed.length > 0 ? seed : [{ timeMs: seg.startMs, strength: 0.5 }],
      seg.bpm,
      seg.endMs,
    );

    for (const b of localBeats) {
      if (b.timeMs >= seg.startMs - 1 && b.timeMs < seg.endMs + 1) {
        beats.push({
          timeMs: Math.max(seg.startMs, b.timeMs),
          strength: b.strength,
        });
      }
    }

    if (!beats.some((b) => Math.abs(b.timeMs - seg.startMs) <= 5)) {
      beats.push({ timeMs: seg.startMs, strength: 0.5 });
    }
  }

  beats.sort((a, b) => a.timeMs - b.timeMs);
  const out: BeatOnset[] = [];
  for (const b of beats) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.timeMs - b.timeMs) < 20) {
      if (b.strength > prev.strength) out[out.length - 1] = b;
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Convert tempo segments into osu uninherited timing points `[timeMs, beatLengthMs]`. */
export function tempoMapToTimingPoints(
  segments: TempoSegment[],
  timingOffsetMs = 0,
): Array<[number, number]> {
  if (segments.length === 0) {
    return [[timingOffsetMs, 500]];
  }

  const points: Array<[number, number]> = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    let t = seg.startMs;
    if (i === 0) {
      t = Math.max(seg.startMs, timingOffsetMs);
    }
    if (points.length > 0 && t <= points[points.length - 1]![0]) {
      points[points.length - 1] = [
        points[points.length - 1]![0],
        seg.beatLengthMs,
      ];
      continue;
    }
    points.push([Math.round(t), seg.beatLengthMs]);
  }

  if (points.length === 0) {
    points.push([timingOffsetMs, segments[0]!.beatLengthMs]);
  } else if (points[0]![0] > timingOffsetMs && timingOffsetMs >= 0) {
    points[0] = [Math.round(timingOffsetMs), points[0]![1]];
  }

  return points;
}
