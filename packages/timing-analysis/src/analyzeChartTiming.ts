import { isHold, parseOsuChart, type ParsedOsuChart } from "@roxysu/osu-chart";
import {
  beatLengthToBpm,
  fitDominantSnap,
  getBeatLengthAt,
  getTimingOriginAt,
  snapDeviationMs,
} from "./timingGrid";
import type {
  TimingAnalysisOptions,
  TimingAnalysisResult,
  TimingIssue,
  TimingMetrics,
} from "./types";

const DEFAULT_SNAP_TOLERANCE_MS = 3;
const DEFAULT_DENSITY_WARN = 24;
const DEFAULT_OVERLAP_EPS_MS = 1;

function uniqueSorted(times: number[]): number[] {
  if (times.length === 0) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const out = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== out[out.length - 1]) out.push(sorted[i]!);
  }
  return out;
}

function checkMissingTiming(chart: ParsedOsuChart): TimingIssue[] {
  if (chart.timingPoints.length > 0) return [];
  return [
    {
      kind: "missing_timing_points",
      severity: "error",
      startMs: 0,
      message: "Chart has no uninherited timing points",
    },
  ];
}

function checkBpmChanges(chart: ParsedOsuChart): TimingIssue[] {
  const issues: TimingIssue[] = [];
  const points = chart.timingPoints;
  for (let i = 1; i < points.length; i += 1) {
    const [tMs, beatLen] = points[i]!;
    const prevBeatLen = points[i - 1]![1];
    const prevBpm = beatLengthToBpm(prevBeatLen);
    const bpm = beatLengthToBpm(beatLen);
    if (Math.abs(bpm - prevBpm) >= 0.5) {
      issues.push({
        kind: "bpm_change",
        severity: "info",
        startMs: tMs,
        message: `BPM change ${prevBpm.toFixed(1)} → ${bpm.toFixed(1)}`,
        meta: { bpm, previousBpm: prevBpm },
      });
    }
  }
  return issues;
}

function checkOffSnap(
  noteTimes: number[],
  chart: ParsedOsuChart,
  toleranceMs: number,
  dominantSnap: ReturnType<typeof fitDominantSnap>["divisor"],
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  for (const t of noteTimes) {
    const dev = snapDeviationMs(t, chart.timingPoints, dominantSnap);
    if (dev <= toleranceMs) continue;
    issues.push({
      kind: "off_snap",
      severity: dev > toleranceMs * 3 ? "warn" : "info",
      startMs: t,
      message: `Note ${Math.round(t)}ms is ${dev.toFixed(1)}ms off 1/${dominantSnap} snap`,
      meta: { deviationMs: dev, divisor: dominantSnap },
    });
  }
  return issues;
}

function checkInconsistentSnap(
  noteTimes: number[],
  chart: ParsedOsuChart,
  toleranceMs: number,
  dominant: ReturnType<typeof fitDominantSnap>,
): TimingIssue[] {
  if (noteTimes.length < 16) return [];

  const altDivisors = [3, 4, 6, 8, 12, 16].filter((d) => d !== dominant.divisor);
  let runnerUpCoverage = 0;
  for (const divisor of altDivisors) {
    let hits = 0;
    for (const t of noteTimes) {
      if (snapDeviationMs(t, chart.timingPoints, divisor as typeof dominant.divisor) <= toleranceMs) {
        hits += 1;
      }
    }
    runnerUpCoverage = Math.max(runnerUpCoverage, hits / noteTimes.length);
  }

  if (runnerUpCoverage < 0.35 || dominant.coverage < 0.55) return [];

  return [
    {
      kind: "inconsistent_snap",
      severity: "warn",
      startMs: noteTimes[0]!,
      endMs: noteTimes[noteTimes.length - 1]!,
      message: `Snap fit is ambiguous (1/${dominant.divisor} ${(dominant.coverage * 100).toFixed(0)}%, alternate grid ${(runnerUpCoverage * 100).toFixed(0)}%)`,
      meta: {
        dominantSnap: dominant.divisor,
        dominantCoverage: dominant.coverage,
        alternateCoverage: runnerUpCoverage,
      },
    },
  ];
}

function checkDensity(
  notes: ParsedOsuChart["notes"],
  chart: ParsedOsuChart,
  threshold: number,
): { issues: TimingIssue[]; peakNotesPerBeat: number } {
  const issues: TimingIssue[] = [];
  if (notes.length === 0) return { issues, peakNotesPerBeat: 0 };

  const starts = notes.map((n) => n.startMs).sort((a, b) => a - b);
  let peak = 0;
  let lo = 0;

  for (let hi = 0; hi < starts.length; hi += 1) {
    const beatLen = getBeatLengthAt(chart.timingPoints, starts[hi]!);
    const windowStart = starts[hi]! - beatLen;

    while (lo <= hi && starts[lo]! < windowStart) lo += 1;

    const count = hi - lo + 1;
    peak = Math.max(peak, count);

    if (count >= threshold) {
      issues.push({
        kind: "high_density",
        severity: count >= threshold * 1.5 ? "warn" : "info",
        startMs: starts[lo]!,
        endMs: starts[hi]!,
        message: `${count} notes within one beat (≥ ${threshold})`,
        meta: { count, threshold, beatLengthMs: beatLen },
      });
    }
  }

  return { issues, peakNotesPerBeat: peak };
}

function checkLnSnap(
  notes: ParsedOsuChart["notes"],
  chart: ParsedOsuChart,
  toleranceMs: number,
  dominantSnap: ReturnType<typeof fitDominantSnap>["divisor"],
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  for (const note of notes) {
    if (!isHold(note)) continue;
    for (const edgeMs of [note.startMs, note.endMs]) {
      const dev = snapDeviationMs(edgeMs, chart.timingPoints, dominantSnap);
      if (dev <= toleranceMs) continue;
      issues.push({
        kind: "ln_off_snap",
        severity: "info",
        startMs: edgeMs,
        message: `LN ${edgeMs === note.startMs ? "head" : "tail"} at ${Math.round(edgeMs)}ms is ${dev.toFixed(1)}ms off snap`,
        meta: {
          column: note.column,
          edge: edgeMs === note.startMs ? "head" : "tail",
          deviationMs: dev,
        },
      });
    }
  }
  return issues;
}

function checkOverlaps(
  notes: ParsedOsuChart["notes"],
  epsilonMs: number,
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  const byCol = new Map<number, ParsedOsuChart["notes"]>();

  for (const note of notes) {
    if (!byCol.has(note.column)) byCol.set(note.column, []);
    byCol.get(note.column)!.push(note);
  }

  for (const [column, colNotes] of byCol) {
    colNotes.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < colNotes.length; i += 1) {
      const prev = colNotes[i - 1]!;
      const cur = colNotes[i]!;
      const prevEnd = Math.max(prev.startMs, prev.endMs);
      if (cur.startMs < prevEnd - epsilonMs) {
        issues.push({
          kind: "overlap",
          severity: "warn",
          startMs: cur.startMs,
          endMs: prevEnd,
          message: `Column ${column} overlap ${Math.round(cur.startMs)}ms with prior object ending ${Math.round(prevEnd)}ms`,
          meta: { column, overlapMs: prevEnd - cur.startMs },
        });
      }
    }
  }

  return issues;
}

function buildMetrics(
  chart: ParsedOsuChart,
  noteTimes: number[],
  dominant: ReturnType<typeof fitDominantSnap>,
  peakNotesPerBeat: number,
  offSnapCount: number,
): TimingMetrics {
  const firstBeatLen =
    chart.timingPoints[0]?.[1] ??
    getBeatLengthAt(chart.timingPoints, noteTimes[0] ?? 0);

  return {
    bpm: beatLengthToBpm(firstBeatLen),
    dominantSnap: dominant.divisor,
    snapCoverage: dominant.coverage,
    offSnapRatio: noteTimes.length > 0 ? offSnapCount / noteTimes.length : 0,
    peakNotesPerBeat,
    timingPointCount: chart.timingPoints.length,
  };
}

/** Analyze snap/BPM/density consistency for a parsed chart. */
export function analyzeChartTiming(
  chart: ParsedOsuChart,
  options: TimingAnalysisOptions = {},
): TimingAnalysisResult {
  const toleranceMs = options.snapToleranceMs ?? DEFAULT_SNAP_TOLERANCE_MS;
  const densityThreshold = options.densityWarnThreshold ?? DEFAULT_DENSITY_WARN;
  const overlapEpsilonMs = options.overlapEpsilonMs ?? DEFAULT_OVERLAP_EPS_MS;

  const issues: TimingIssue[] = [];
  issues.push(...checkMissingTiming(chart));
  issues.push(...checkBpmChanges(chart));

  const noteTimes = uniqueSorted(chart.notes.map((n) => n.startMs));
  const dominant = fitDominantSnap(noteTimes, chart.timingPoints, toleranceMs);

  issues.push(...checkOffSnap(noteTimes, chart, toleranceMs, dominant.divisor));
  issues.push(
    ...checkInconsistentSnap(noteTimes, chart, toleranceMs, dominant),
  );

  const density = checkDensity(chart.notes, chart, densityThreshold);
  issues.push(...density.issues);

  issues.push(
    ...checkLnSnap(chart.notes, chart, toleranceMs, dominant.divisor),
  );
  issues.push(...checkOverlaps(chart.notes, overlapEpsilonMs));

  const offSnapCount = issues.filter((i) => i.kind === "off_snap").length;

  return {
    algorithm: "timing-v1",
    metrics: buildMetrics(
      chart,
      noteTimes,
      dominant,
      density.peakNotesPerBeat,
      offSnapCount,
    ),
    issues: issues.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind)),
  };
}

/** Parse `.osu` text and run timing analysis. */
export function analyzeTimingFromOsuText(
  osuText: string,
  options?: TimingAnalysisOptions,
): TimingAnalysisResult {
  return analyzeChartTiming(parseOsuChart(osuText), options);
}

/** Compare chart note times to an external beat grid (e.g. from audio analysis). */
export function compareNotesToBeatGrid(
  noteTimes: number[],
  beatTimesMs: number[],
  toleranceMs = 35,
): TimingIssue[] {
  if (beatTimesMs.length === 0 || noteTimes.length === 0) return [];

  const issues: TimingIssue[] = [];
  const sortedBeats = [...beatTimesMs].sort((a, b) => a - b);

  for (const t of noteTimes) {
    let best = Infinity;
    for (const beat of sortedBeats) {
      const d = Math.abs(t - beat);
      if (d < best) best = d;
      if (beat > t + toleranceMs * 4) break;
    }
    if (best > toleranceMs) {
      issues.push({
        kind: "off_snap",
        severity: best > toleranceMs * 2 ? "warn" : "info",
        startMs: t,
        message: `Note ${Math.round(t)}ms is ${best.toFixed(0)}ms from nearest detected beat`,
        meta: { deviationMs: best, source: "audio_grid" },
      });
    }
  }

  return issues;
}
