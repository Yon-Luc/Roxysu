import {
  analyzeChartTiming,
  fitDominantSnap,
  type ParsedOsuChart,
} from "../../timing-analysis/src/index";
import {
  analyze7kStructuralNotes,
  type StructuralPatternResult,
} from "../../pattern-7k/src/index";
import type { ChartNote, ManiaOsuChart } from "../../osu-chart/src/index";
import {
  findEmptyColumns,
  findIllegalOverlaps,
} from "../../mapgen-core/src/index";
import type {
  EvalInput,
  MapgenFeatureSnapshot,
  QuantileSummary,
  ReferenceBucketKey,
  ReferenceBucketStats,
  ReferenceStats,
  ScoreResult,
} from "./types";

function toParsedChart(chart: ManiaOsuChart | ParsedOsuChart): ParsedOsuChart {
  if ("gameMode" in chart) return chart;
  const lnCount = chart.notes.filter((note) => note.endMs > note.startMs).length;
  return {
    columnCount: chart.difficulty.columnCount,
    gameMode: "3",
    status: "Ok",
    lnRatio: chart.notes.length > 0 ? lnCount / chart.notes.length : 0,
    notes: chart.notes,
    timingPoints: chart.timingPoints,
    breaks: [],
    metaData: {
      Title: chart.metadata.title,
      Artist: chart.metadata.artist,
      Version: chart.metadata.version,
      Creator: chart.metadata.creator,
    },
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(q * (sortedValues.length - 1))),
  );
  return sortedValues[idx] ?? 0;
}

function summarize(values: number[]): QuantileSummary {
  if (values.length === 0) {
    return { min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? 0,
    mean: mean(sorted),
  };
}

function entropyFromCounts(counts: Iterable<number>): number {
  const values = [...counts].filter((value) => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return values.reduce((sum, value) => {
    const p = value / total;
    return sum - p * Math.log2(p);
  }, 0);
}

function groupNoteStarts(notes: ChartNote[]): Map<number, ChartNote[]> {
  const grouped = new Map<number, ChartNote[]>();
  for (const note of notes) {
    const bucket = grouped.get(note.startMs);
    if (bucket) bucket.push(note);
    else grouped.set(note.startMs, [note]);
  }
  return grouped;
}

function bucketLabel(value: number, size: number): string {
  const start = Math.floor(value / size) * size;
  return `${start}-${start + size - 1}`;
}

export function bucketFor(
  sunnyStar: number | null | undefined,
  bpm: number | null | undefined,
): ReferenceBucketKey {
  const safeStar = Number.isFinite(sunnyStar) ? Number(sunnyStar) : 0;
  const safeBpm = Number.isFinite(bpm) ? Number(bpm) : 120;
  return {
    starBand: `${Math.floor(safeStar * 2) / 2}-${Math.floor(safeStar * 2) / 2 + 0.5}`,
    bpmBand: bucketLabel(safeBpm, 20),
  };
}

function countTransitions(notes: ChartNote[]): Record<string, number> {
  const grouped = [...groupNoteStarts(notes).entries()].sort((a, b) => a[0] - b[0]);
  const counts = new Map<string, number>();
  for (let i = 1; i < grouped.length; i += 1) {
    const prev = grouped[i - 1]![1].map((note) => note.column).sort((a, b) => a - b);
    const next = grouped[i]![1].map((note) => note.column).sort((a, b) => a - b);
    const key = `${prev.join("+")}→${next.join("+")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts.entries());
}

function buildSnapshot(
  chart: ParsedOsuChart,
  bpmOverride?: number | null,
): MapgenFeatureSnapshot {
  const pattern = analyze7kStructuralNotes(chart.notes) as StructuralPatternResult;
  const timing = analyzeChartTiming(chart);
  const durationMs =
    chart.notes.length > 0 ? Math.max(...chart.notes.map((note) => note.endMs)) : 0;
  const durationSec = Math.max(durationMs / 1000, 1);
  const columnUsage = Array.from({ length: chart.columnCount }, () => 0);
  for (const note of chart.notes) {
    if (note.column >= 0 && note.column < chart.columnCount) {
      columnUsage[note.column] = (columnUsage[note.column] ?? 0) + 1;
    }
  }

  const grouped = [...groupNoteStarts(chart.notes).values()];
  const chordHistogram = new Map<string, number>();
  for (const notesAtTime of grouped) {
    const size = String(notesAtTime.length);
    chordHistogram.set(size, (chordHistogram.get(size) ?? 0) + 1);
  }

  const transitions = countTransitions(chart.notes);
  const dominantSnap = fitDominantSnap(
    [...new Set(chart.notes.map((note) => note.startMs))],
    chart.timingPoints,
  ).divisor;

  return {
    noteCount: chart.notes.length,
    notesPerSecond: chart.notes.length / durationSec,
    lnRatio: chart.lnRatio,
    bpm:
      bpmOverride ??
      (chart.timingPoints[0]?.[1] ? 60_000 / chart.timingPoints[0][1] : 120),
    dominantSnap,
    offSnapRatio: timing.metrics.offSnapRatio,
    peakNotesPerBeat: timing.metrics.peakNotesPerBeat,
    timingPointCount: chart.timingPoints.length,
    dominantPattern: pattern.dominantPattern,
    columnUsage,
    columnUsageEntropy: entropyFromCounts(columnUsage),
    chordHistogram: Object.fromEntries(chordHistogram.entries()),
    chordMean: mean(grouped.map((notesAtTime) => notesAtTime.length)),
    transitionEntropy: entropyFromCounts(Object.values(transitions)),
    transitions,
    pattern,
    timing,
  };
}

function combineTransitions(rows: MapgenFeatureSnapshot[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [key, count] of Object.entries(row.transitions)) {
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([key, count]) => ({ key, count }));
}

export function analyzeMapgenChart(input: EvalInput): MapgenFeatureSnapshot {
  const parsed = toParsedChart(input.chart);
  return buildSnapshot(parsed, input.explicitBpm ?? null);
}

export function buildReferenceStats(
  inputs: Array<EvalInput & { sunnyStar?: number | null }>,
): ReferenceStats {
  const grouped = new Map<string, { bucket: ReferenceBucketKey; rows: MapgenFeatureSnapshot[] }>();

  for (const input of inputs) {
    const parsed = toParsedChart(input.chart);
    const snapshot = buildSnapshot(parsed, input.explicitBpm ?? null);
    const bucket = bucketFor(input.sunnyStar, snapshot.bpm);
    const key = `${bucket.starBand}__${bucket.bpmBand}`;
    const existing = grouped.get(key);
    if (existing) existing.rows.push(snapshot);
    else grouped.set(key, { bucket, rows: [snapshot] });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCharts: inputs.length,
    buckets: [...grouped.values()].map(({ bucket, rows }) => {
      const dominantSnapCounts: Record<string, number> = {};
      const dominantPatternCounts: Record<string, number> = {};
      const columnUsageMean = Array.from({ length: 7 }, (_, column) =>
        mean(rows.map((row) => row.columnUsage[column] ?? 0)),
      );
      for (const row of rows) {
        dominantSnapCounts[String(row.dominantSnap)] =
          (dominantSnapCounts[String(row.dominantSnap)] ?? 0) + 1;
        if (row.dominantPattern) {
          dominantPatternCounts[row.dominantPattern] =
            (dominantPatternCounts[row.dominantPattern] ?? 0) + 1;
        }
      }
      return {
        ...bucket,
        sampleCount: rows.length,
        notesPerSecond: summarize(rows.map((row) => row.notesPerSecond)),
        lnRatio: summarize(rows.map((row) => row.lnRatio)),
        dominantSnapCounts,
        offSnapRatio: summarize(rows.map((row) => row.offSnapRatio)),
        peakNotesPerBeat: summarize(rows.map((row) => row.peakNotesPerBeat)),
        timingPointCount: summarize(rows.map((row) => row.timingPointCount)),
        columnUsageMean,
        columnUsageEntropy: summarize(rows.map((row) => row.columnUsageEntropy)),
        chordMean: summarize(rows.map((row) => row.chordMean)),
        transitionEntropy: summarize(rows.map((row) => row.transitionEntropy)),
        transitionTop: combineTransitions(rows),
        dominantPatternCounts,
      };
    }),
  };
}

export function pickReferenceBucket(
  stats: ReferenceStats,
  bucket: ReferenceBucketKey,
): ReferenceBucketStats | null {
  return (
    stats.buckets.find(
      (entry) =>
        entry.starBand === bucket.starBand && entry.bpmBand === bucket.bpmBand,
    ) ?? null
  );
}

function verdict(value: number, target: QuantileSummary | null): "low" | "ok" | "high" | "unknown" {
  if (!target) return "unknown";
  if (value < target.p25) return "low";
  if (value > target.p75) return "high";
  return "ok";
}

function modeCount(counts: Record<string, number>): string | null {
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ordered[0]?.[0] ?? null;
}

export function scoreMapgenChart(
  chart: EvalInput,
  stats: ReferenceStats,
): ScoreResult {
  const parsed = toParsedChart(chart.chart);
  const snapshot = buildSnapshot(parsed, chart.explicitBpm ?? null);
  const bucketKey = bucketFor(chart.sunnyStar, snapshot.bpm);
  const bucket = pickReferenceBucket(stats, bucketKey);

  return {
    bucket: bucketKey,
    snapshot,
    metrics: {
      notesPerSecond: {
        value: snapshot.notesPerSecond,
        target: bucket?.notesPerSecond ?? null,
        verdict: verdict(snapshot.notesPerSecond, bucket?.notesPerSecond ?? null),
      },
      lnRatio: {
        value: snapshot.lnRatio,
        target: bucket?.lnRatio ?? null,
        verdict: verdict(snapshot.lnRatio, bucket?.lnRatio ?? null),
      },
      offSnapRatio: {
        value: snapshot.offSnapRatio,
        target: bucket?.offSnapRatio ?? null,
        verdict: verdict(snapshot.offSnapRatio, bucket?.offSnapRatio ?? null),
      },
      peakNotesPerBeat: {
        value: snapshot.peakNotesPerBeat,
        target: bucket?.peakNotesPerBeat ?? null,
        verdict: verdict(snapshot.peakNotesPerBeat, bucket?.peakNotesPerBeat ?? null),
      },
      timingPointCount: {
        value: snapshot.timingPointCount,
        target: bucket?.timingPointCount ?? null,
        verdict: verdict(snapshot.timingPointCount, bucket?.timingPointCount ?? null),
      },
      columnUsageEntropy: {
        value: snapshot.columnUsageEntropy,
        target: bucket?.columnUsageEntropy ?? null,
        verdict: verdict(snapshot.columnUsageEntropy, bucket?.columnUsageEntropy ?? null),
      },
      chordMean: {
        value: snapshot.chordMean,
        target: bucket?.chordMean ?? null,
        verdict: verdict(snapshot.chordMean, bucket?.chordMean ?? null),
      },
      transitionEntropy: {
        value: snapshot.transitionEntropy,
        target: bucket?.transitionEntropy ?? null,
        verdict: verdict(snapshot.transitionEntropy, bucket?.transitionEntropy ?? null),
      },
    },
    dominantPatternMatch:
      bucket != null && snapshot.dominantPattern != null
        ? modeCount(bucket.dominantPatternCounts) === snapshot.dominantPattern
        : null,
    dominantSnapMatch:
      bucket != null ? modeCount(bucket.dominantSnapCounts) === String(snapshot.dominantSnap) : null,
    rc: {
      illegalOverlaps: findIllegalOverlaps(parsed.notes).length,
      emptyColumns: findEmptyColumns(parsed.notes, parsed.columnCount).length,
    },
  };
}
