import type { AudioAnalysisResult } from "@roxysu/audio-analysis";
import {
  buildManiaOsuText,
  type ChartNote,
  type ManiaOsuChart,
} from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";
import { analyze7kStructuralNotes } from "@roxysu/pattern-7k";
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

/** Generate a 7K mania chart from audio analysis + pattern targets. */
export function generateMapFromAudio(
  audio: AudioAnalysisResult,
  rawTargets: PatternTargets = {},
  options: MapgenOptions = {},
): MapgenResult {
  const columnCount = options.columnCount ?? 7;
  const snapDivisor = options.snapDivisor ?? 4;
  const segmentBeats = options.segmentBeats ?? 8;
  const seed = options.seed ?? Date.now();
  const rng = createRng(seed);

  const merged = { ...DEFAULT_TARGETS, ...rawTargets };
  const lnTarget = merged.ln ?? 0;
  const patternTargets = normalizeTargets(
    Object.fromEntries(
      Object.entries(merged).filter(([k]) => k !== "ln"),
    ),
  );

  const bpm = resolveBpm(audio, options.bpm);
  const beatMs = 60_000 / bpm;
  const snapMs = beatMs / snapDivisor;
  const endMs = options.endMs ?? audio.durationMs;
  const segmentMs = segmentBeats * beatMs;

  const weightItems = Object.entries(patternTargets).map(([key, weight]) => ({
    key: key as PatternLabelV2,
    weight,
  }));

  const segments: MapgenResult["segments"] = [];
  const notes: ChartNote[] = [];
  const ctx = { columnCount, snapMs, rng };

  for (let segStart = 0; segStart < endMs; segStart += segmentMs) {
    const segEnd = Math.min(endMs, segStart + segmentMs);
    const pattern = pickWeighted(weightItems, rng);
    segments.push({ startMs: segStart, endMs: segEnd, pattern });

    const steps = Math.max(
      1,
      Math.floor((segEnd - segStart) / snapMs),
    );
    const emitted = PATTERN_EMITTERS[pattern](segStart, steps, ctx);
    notes.push(...emitted);
  }

  const withLn = applyLnRatio(notes, lnTarget, beatMs, rng);

  const sorted = withLn.sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );

  const chart: ManiaOsuChart = {
    metadata: {
      title: options.metadata?.title ?? "Generated Chart",
      artist: options.metadata?.artist ?? "Unknown",
      creator: options.metadata?.creator ?? "Roxysu Mapgen",
      version: options.metadata?.version ?? "Generated",
      audioFilename: options.audioFilename ?? "audio.mp3",
    },
    difficulty: {
      columnCount,
      overallDifficulty: 8,
      hpDrainRate: 7,
    },
    timingPoints: [[0, beatMs]],
    notes: sorted,
  };

  return {
    chart,
    notes: sorted,
    audio,
    segments,
    targets: { ...patternTargets, ln: lnTarget },
    bpm,
  };
}

/** Analyze the generated chart with pattern-7k v2 for verification. */
export function analyzeGeneratedPatterns(notes: ChartNote[]) {
  return analyze7kStructuralNotes(notes);
}

export { buildManiaOsuText };
