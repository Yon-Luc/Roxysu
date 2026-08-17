import { parseOsuChart } from "./parse";
import type { ChartNote } from "./types";
import {
  buildManiaOsuText,
  type ManiaOsuChart,
  type ManiaOsuMetadata,
  type TimingPointRow,
} from "./write";

export type FuseManiaSource = {
  osuText: string;
  audioDurationMs: number;
};

export type FuseManiaOptions = {
  pauseMs: number;
  metadata: ManiaOsuMetadata;
};

export type FuseManiaResult = {
  chart: ManiaOsuChart;
  osuText: string;
  segmentStartsMs: number[];
  totalDurationMs: number;
  keyCount: number;
};

export type FuseTimingMismatch = {
  mapIndex: number;
  kind: "note_count" | "note_time" | "bpm" | "timing_count";
  message: string;
};

const TIME_EPS_MS = 1;
const BEAT_EPS = 1e-6;

export function beatLengthToBpm(beatLengthMs: number): number {
  if (beatLengthMs <= 0) return 0;
  return 60_000 / beatLengthMs;
}

export function parseTimingPointRows(osuText: string): TimingPointRow[] {
  const rows: TimingPointRow[] = [];
  let inTiming = false;
  for (const raw of osuText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inTiming = line === "[TimingPoints]";
      continue;
    }
    if (!inTiming) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const timeMs = Number.parseFloat(parts[0]!);
    const beatLength = Number.parseFloat(parts[1]!);
    if (!Number.isFinite(timeMs) || !Number.isFinite(beatLength)) continue;
    const uninherited =
      parts.length < 7 ? beatLength > 0 : parts[6]!.trim() === "1";
    rows.push({
      timeMs,
      beatLength,
      meter: intOr(parts[2], 4),
      sampleSet: intOr(parts[3], 2),
      sampleIndex: intOr(parts[4], 0),
      volume: intOr(parts[5], 100),
      uninherited: uninherited && beatLength > 0,
      effects: intOr(parts[7], 0),
    });
  }
  rows.sort((a, b) => a.timeMs - b.timeMs);
  return rows;
}

function parseDifficultyNumber(osuText: string, key: string, fallback: number): number {
  const prefix = `${key.toLowerCase()}:`;
  for (const raw of osuText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.toLowerCase().startsWith(prefix)) continue;
    const n = Number.parseFloat(line.slice(line.indexOf(":") + 1).trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function parseHpDrainRate(osuText: string): number {
  return parseDifficultyNumber(osuText, "HPDrainRate", 7);
}

export function fuseManiaCharts(
  sources: FuseManiaSource[],
  options: FuseManiaOptions,
): FuseManiaResult {
  if (sources.length < 2) {
    throw new Error("Need at least two maps to fuse");
  }

  const pauseMs = Math.max(0, options.pauseMs);
  const parsed = sources.map((source, index) => {
    const chart = parseOsuChart(source.osuText);
    if (chart.status === "NotMania" || chart.gameMode !== "3") {
      throw new Error(`Map ${index + 1} is not mania`);
    }
    if (chart.status === "Fail" || chart.columnCount <= 0) {
      throw new Error(`Map ${index + 1} failed to parse`);
    }
    const durationMs = Math.max(0, source.audioDurationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`Map ${index + 1} has no audio duration`);
    }
    return {
      chart,
      durationMs,
      timing: parseTimingPointRows(source.osuText),
      hp: parseHpDrainRate(source.osuText),
      od: parseDifficultyNumber(source.osuText, "OverallDifficulty", 8),
    };
  });

  const keyCount = parsed[0]!.chart.columnCount;
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i]!.chart.columnCount !== keyCount) {
      throw new Error(
        `Mixed key counts: ${keyCount}K and ${parsed[i]!.chart.columnCount}K`,
      );
    }
  }

  const notes: ChartNote[] = [];
  const fullTimingPoints: TimingPointRow[] = [];
  const breaks: Array<[number, number]> = [];
  const segmentStartsMs: number[] = [];
  let offset = 0;

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i]!;
    segmentStartsMs.push(offset);

    for (const note of item.chart.notes) {
      const startMs = Math.max(0, note.startMs) + offset;
      const endMs = Math.max(startMs, Math.max(0, note.endMs) + offset);
      notes.push({ column: note.column, startMs, endMs });
    }

    for (const row of item.timing) {
      const localTime = Math.max(0, row.timeMs);
      fullTimingPoints.push({ ...row, timeMs: localTime + offset });
    }

    if (item.chart.timingPoints.length === 0 && item.timing.length === 0) {
      fullTimingPoints.push({
        timeMs: offset,
        beatLength: 500,
        uninherited: true,
      });
    }

    offset += item.durationMs;
    if (i < parsed.length - 1 && pauseMs > 0) {
      breaks.push([offset, offset + pauseMs]);
      offset += pauseMs;
    }
  }

  fullTimingPoints.sort((a, b) => a.timeMs - b.timeMs || Number(b.uninherited) - Number(a.uninherited));
  notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);

  const first = parsed[0]!;
  const chart: ManiaOsuChart = {
    metadata: options.metadata,
    difficulty: {
      columnCount: keyCount,
      hpDrainRate: first.hp,
      overallDifficulty: first.od,
    },
    timingPoints: fullTimingPoints
      .filter((row) => row.uninherited !== false)
      .map((row) => [row.timeMs, row.beatLength]),
    fullTimingPoints,
    breaks,
    notes,
  };

  const osuText = buildManiaOsuText(chart);
  const result: FuseManiaResult = {
    chart,
    osuText,
    segmentStartsMs,
    totalDurationMs: offset,
    keyCount,
  };
  const check = checkFusedMatchesOriginals(sources, result);
  if (!check.ok) {
    throw new Error(check.mismatches[0]?.message ?? "Fused timing does not match originals");
  }
  return result;
}

export function checkFusedMatchesOriginals(
  sources: FuseManiaSource[],
  fused: FuseManiaResult,
): { ok: boolean; mismatches: FuseTimingMismatch[] } {
  const mismatches: FuseTimingMismatch[] = [];
  const writtenNotes = parseOsuChart(fused.osuText).notes;
  const writtenTiming = parseTimingPointRows(fused.osuText);

  for (let i = 0; i < sources.length; i += 1) {
    const offset = fused.segmentStartsMs[i];
    if (offset == null) {
      mismatches.push({
        mapIndex: i,
        kind: "timing_count",
        message: `Map ${i + 1}: missing fused segment start`,
      });
      continue;
    }

    const original = parseOsuChart(sources[i]!.osuText);
    const origNotes = [...original.notes]
      .map((n) => ({
        column: n.column,
        startMs: Math.max(0, n.startMs),
        endMs: Math.max(Math.max(0, n.startMs), Math.max(0, n.endMs)),
      }))
      .sort((a, b) => a.startMs - b.startMs || a.column - b.column);

    const expectedNotes = origNotes.map((n) => ({
      column: n.column,
      startMs: n.startMs + offset,
      endMs: n.endMs + offset,
    }));

    compareNotes(i, expectedNotes, fused.chart.notes, mismatches, "fused");
    compareNotes(i, expectedNotes, writtenNotes, mismatches, "written");

    const origTiming = parseTimingPointRows(sources[i]!.osuText).map((row) => ({
      ...row,
      timeMs: Math.max(0, row.timeMs) + offset,
    }));
    compareTiming(i, origTiming, fused.chart.fullTimingPoints ?? [], mismatches, "fused");
    compareTiming(i, origTiming, writtenTiming, mismatches, "written");
  }

  return { ok: mismatches.length === 0, mismatches };
}

function compareNotes(
  mapIndex: number,
  expected: ChartNote[],
  actualAll: ChartNote[],
  mismatches: FuseTimingMismatch[],
  label: string,
): void {
  const actual = matchNotes(expected, actualAll);
  if (actual.length !== expected.length) {
    mismatches.push({
      mapIndex,
      kind: "note_count",
      message: `Map ${mapIndex + 1} (${label}): expected ${expected.length} notes, found ${actual.length}`,
    });
    return;
  }
  for (let i = 0; i < expected.length; i += 1) {
    const exp = expected[i]!;
    const got = actual[i]!;
    if (got.column !== exp.column) {
      mismatches.push({
        mapIndex,
        kind: "note_time",
        message: `Map ${mapIndex + 1} (${label}): note ${i + 1} column ${got.column} ≠ ${exp.column}`,
      });
      return;
    }
    if (Math.abs(got.startMs - exp.startMs) > TIME_EPS_MS) {
      mismatches.push({
        mapIndex,
        kind: "note_time",
        message: `Map ${mapIndex + 1} (${label}): note ${i + 1} at ${Math.round(got.startMs)}ms, expected ${Math.round(exp.startMs)}ms`,
      });
      return;
    }
    if (Math.abs(got.endMs - exp.endMs) > TIME_EPS_MS) {
      mismatches.push({
        mapIndex,
        kind: "note_time",
        message: `Map ${mapIndex + 1} (${label}): note ${i + 1} end ${Math.round(got.endMs)}ms, expected ${Math.round(exp.endMs)}ms`,
      });
      return;
    }
  }
}

function matchNotes(expected: ChartNote[], actualAll: ChartNote[]): ChartNote[] {
  const remaining = [...actualAll].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );
  const matched: ChartNote[] = [];
  for (const exp of expected) {
    const idx = remaining.findIndex(
      (n) =>
        n.column === exp.column &&
        Math.abs(n.startMs - exp.startMs) <= TIME_EPS_MS,
    );
    if (idx < 0) continue;
    matched.push(remaining.splice(idx, 1)[0]!);
  }
  return matched;
}

function compareTiming(
  mapIndex: number,
  expected: TimingPointRow[],
  actualAll: TimingPointRow[],
  mismatches: FuseTimingMismatch[],
  label: string,
): void {
  const remaining = [...actualAll];
  const matched: TimingPointRow[] = [];
  for (const exp of expected) {
    const idx = remaining.findIndex(
      (row) =>
        Math.abs(row.timeMs - exp.timeMs) <= TIME_EPS_MS &&
        Boolean(row.uninherited) === Boolean(exp.uninherited),
    );
    if (idx < 0) continue;
    matched.push(remaining.splice(idx, 1)[0]!);
  }

  if (matched.length !== expected.length) {
    mismatches.push({
      mapIndex,
      kind: "timing_count",
      message: `Map ${mapIndex + 1} (${label}): expected ${expected.length} timing points, found ${matched.length}`,
    });
    return;
  }

  for (let i = 0; i < expected.length; i += 1) {
    const exp = expected[i]!;
    const got = matched[i]!;
    if (Math.abs(got.beatLength - exp.beatLength) <= BEAT_EPS) continue;
    const expBpm = beatLengthToBpm(exp.beatLength);
    const gotBpm = beatLengthToBpm(got.beatLength);
    if (exp.uninherited !== false && Math.abs(gotBpm - expBpm) < 0.01) continue;
    mismatches.push({
      mapIndex,
      kind: "bpm",
      message:
        exp.uninherited === false
          ? `Map ${mapIndex + 1} (${label}): SV beatLength ${got.beatLength} ≠ ${exp.beatLength}`
          : `Map ${mapIndex + 1} (${label}): BPM ${gotBpm.toFixed(3)} ≠ ${expBpm.toFixed(3)}`,
    });
    return;
  }
}

function intOr(value: string | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
