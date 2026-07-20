import type { AudioAnalysisResult } from "@roxysu/audio-analysis";
import {
  buildManiaOsuText,
  type ChartNote,
  type ManiaOsuChart,
} from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";
import { analyze7kStructuralNotes } from "@roxysu/pattern-7k";
import { resolveDanPreset } from "./danPresets";
import { PATTERN_EMITTERS, applyLnRatio } from "./templates";
import { createRng, normalizeTargets, pickWeighted } from "./rng";
import type { MapgenOptions, MapgenResult, PatternTargets } from "./types";

const DEFAULT_TARGETS: PatternTargets = {
  delay: 0.45,
  jack: 0.15,
  chordjack: 0.15,
  chordstream: 0.1,
  bracket: 0.1,
  ln: 0.15,
};

function resolveBpm(audio: AudioAnalysisResult, override?: number): number {
  if (override != null && override > 0) return override;
  if (audio.bpm != null && audio.bpm > 0) return audio.bpm;
  return 120;
}

function hasExplicitPatternWeights(raw: PatternTargets): boolean {
  return (
    (raw.delay != null && raw.delay > 0) ||
    (raw.jack != null && raw.jack > 0) ||
    (raw.chordjack != null && raw.chordjack > 0) ||
    (raw.chordstream != null && raw.chordstream > 0) ||
    (raw.bracket != null && raw.bracket > 0)
  );
}

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

/**
 * Resolve chart timing points.
 * - BPM override → single constant timing point (user wins).
 * - Else prefer audio.timingPoints / tempoMap when present.
 */
function resolveTimingPoints(
  audio: AudioAnalysisResult,
  timingOffsetMs: number,
  bpmOverride: number | undefined,
  fallbackBpm: number,
): Array<[number, number]> {
  const fallbackBeat = 60_000 / fallbackBpm;

  if (bpmOverride != null && bpmOverride > 0) {
    return [[timingOffsetMs, 60_000 / bpmOverride]];
  }

  if (audio.timingPoints && audio.timingPoints.length > 0) {
    const points = audio.timingPoints.map(
      ([t, beatLen]) => [t, beatLen] as [number, number],
    );
    if (points[0]![0] !== timingOffsetMs) {
      points[0] = [timingOffsetMs, points[0]![1]];
    }
    return points;
  }

  if (audio.tempoMap && audio.tempoMap.length > 0) {
    return audio.tempoMap.map((seg, i) => {
      const t = i === 0 ? timingOffsetMs : Math.max(timingOffsetMs, seg.startMs);
      return [t, seg.beatLengthMs] as [number, number];
    });
  }

  return [[timingOffsetMs, fallbackBeat]];
}

/** Generate a 7K mania chart from audio analysis + pattern targets. */
export function generateMapFromAudio(
  audio: AudioAnalysisResult,
  rawTargets: PatternTargets = {},
  options: MapgenOptions = {},
): MapgenResult {
  const dan = resolveDanPreset(options.dan);
  const applyDanPatternBias = options.applyDanPatternBias !== false;
  const applyDanLn = options.applyDanLn !== false;

  const columnCount = options.columnCount ?? 7;
  const snapDivisor =
    options.snapDivisor ?? dan?.snapDivisor ?? 4;
  const noteStride = options.noteStride ?? dan?.noteStride ?? 1;
  const segmentBeats =
    options.segmentBeats ?? dan?.segmentBeats ?? 8;
  const seed = options.seed ?? Date.now();
  const rng = createRng(seed);

  const useDanPatterns =
    Boolean(dan) &&
    applyDanPatternBias &&
    !hasExplicitPatternWeights(rawTargets);

  const patternSource: PatternTargets = useDanPatterns
    ? { ...dan!.patternBias }
    : { ...DEFAULT_TARGETS, ...rawTargets };

  const lnExplicit = rawTargets.ln != null;
  const lnTarget = lnExplicit
    ? (rawTargets.ln ?? 0)
    : dan && applyDanLn
      ? dan.ln
      : (DEFAULT_TARGETS.ln ?? 0);

  // RC dan must stay under Sunny's 20% LN threshold; LN dan must stay above.
  let lnFinal = lnTarget;
  if (dan?.axis === "rc" && lnFinal >= 0.2) lnFinal = 0.15;
  if (dan?.axis === "ln" && lnFinal < 0.2) lnFinal = Math.max(lnFinal, 0.25);

  const { ln: _lnIgnored, ...patternOnly } = patternSource;
  const patternTargets = normalizeTargets(patternOnly);

  const bpm = resolveBpm(audio, options.bpm);
  const timingOffsetMs =
    options.timingOffsetMs ?? audio.timingOffsetMs ?? 0;
  let endMs = options.endMs ?? audio.durationMs;
  if (endMs <= timingOffsetMs) endMs = audio.durationMs;

  const timingPoints = resolveTimingPoints(
    audio,
    timingOffsetMs,
    options.bpm,
    bpm,
  );

  const weightItems = Object.entries(patternTargets).map(([key, weight]) => ({
    key: key as PatternLabelV2,
    weight,
  }));

  const segments: MapgenResult["segments"] = [];
  const notes: ChartNote[] = [];

  // Walk time using local snap so BPM changes mid-chart are respected.
  let segStart = timingOffsetMs;
  const genEnd = Math.max(segStart, endMs);

  while (segStart < genEnd - 1) {
    const localBeatMs = beatLengthAt(timingPoints, segStart);
    const snapMs = localBeatMs / snapDivisor;
    const segmentMs = segmentBeats * localBeatMs;
    const segEnd = Math.min(genEnd, segStart + segmentMs);

    // Truncate segment early if a timing point starts inside it.
    let hardEnd = segEnd;
    for (const [t] of timingPoints) {
      if (t > segStart + 1 && t < hardEnd) {
        hardEnd = t;
        break;
      }
    }

    const pattern = pickWeighted(weightItems, rng);
    segments.push({ startMs: segStart, endMs: hardEnd, pattern });

    const steps = Math.max(1, Math.floor((hardEnd - segStart) / snapMs));
    const ctx = { columnCount, snapMs, rng, noteStride };
    notes.push(...PATTERN_EMITTERS[pattern](segStart, steps, ctx));

    segStart = hardEnd;
  }

  // LN lengths use the beat length at each note's start.
  const withLn = applyLnRatio(
    notes,
    lnFinal,
    (note) => beatLengthAt(timingPoints, note.startMs),
    rng,
  );

  const sorted = withLn.sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );

  const version =
    options.metadata?.version ??
    (dan ? dan.label : "Generated");

  const chart: ManiaOsuChart = {
    metadata: {
      title: options.metadata?.title ?? "Generated Chart",
      artist: options.metadata?.artist ?? "Unknown",
      creator: options.metadata?.creator ?? "Roxysu Mapgen",
      version,
      audioFilename: options.audioFilename ?? "audio.mp3",
      backgroundFilename: options.metadata?.backgroundFilename,
    },
    difficulty: {
      columnCount,
      overallDifficulty: 8,
      hpDrainRate: 7,
    },
    timingPoints,
    notes: sorted,
  };

  return {
    chart,
    notes: sorted,
    audio,
    segments,
    targets: { ...patternTargets, ln: lnFinal },
    bpm,
    timingOffsetMs,
    dan,
    bpmAlternates: audio.bpmAlternates ?? [],
    bpmConfidence: audio.bpmConfidence ?? 0,
    timingPoints,
  };
}

/** Analyze the generated chart with pattern-7k v2 for verification. */
export function analyzeGeneratedPatterns(notes: ChartNote[]) {
  return analyze7kStructuralNotes(notes);
}

export { buildManiaOsuText };
