import { describe, expect, test } from "bun:test";
import type { ParsedOsuChart } from "@roxysu/osu-chart";
import {
  analyzeChartTiming,
  compareNotesToBeatGrid,
  fitDominantSnap,
  quantizeToSnap,
} from "./index";

function chart(partial: Partial<ParsedOsuChart> & Pick<ParsedOsuChart, "notes">): ParsedOsuChart {
  return {
    columnCount: 7,
    gameMode: "3",
    status: "OK",
    lnRatio: 0,
    timingPoints: [[0, 500]],
    breaks: [],
    metaData: {},
    ...partial,
  };
}

describe("timingGrid", () => {
  test("quantizeToSnap aligns 1/4 notes at 500ms beat", () => {
    const timingPoints = [[0, 500]] as ParsedOsuChart["timingPoints"];
    expect(quantizeToSnap(125, timingPoints, 4)).toBe(125);
    expect(quantizeToSnap(128, timingPoints, 4)).toBe(125);
    expect(quantizeToSnap(250, timingPoints, 4)).toBe(250);
  });

  test("fitDominantSnap prefers 1/4 for quarter stream", () => {
    const timingPoints = [[0, 500]] as ParsedOsuChart["timingPoints"];
    const times = Array.from({ length: 16 }, (_, i) => i * 125);
    const fit = fitDominantSnap(times, timingPoints, 3);
    expect(fit.divisor).toBe(4);
    expect(fit.coverage).toBeGreaterThan(0.95);
  });
});

describe("analyzeChartTiming", () => {
  test("flags off-snap note starts", () => {
    const result = analyzeChartTiming(
      chart({
        notes: [
          { column: 0, startMs: 0, endMs: 0 },
          { column: 1, startMs: 125, endMs: 125 },
          { column: 2, startMs: 260, endMs: 260 },
        ],
      }),
    );
    expect(result.metrics.dominantSnap).toBe(4);
    expect(result.issues.some((i) => i.kind === "off_snap")).toBe(true);
  });

  test("detects same-column overlap", () => {
    const result = analyzeChartTiming(
      chart({
        notes: [
          { column: 2, startMs: 1000, endMs: 1500 },
          { column: 2, startMs: 1200, endMs: 1200 },
        ],
      }),
    );
    expect(result.issues.some((i) => i.kind === "overlap")).toBe(true);
  });

  test("reports BPM change timing points", () => {
    const result = analyzeChartTiming(
      chart({
        timingPoints: [
          [0, 500],
          [4000, 400],
        ],
        notes: [{ column: 0, startMs: 0, endMs: 0 }],
      }),
    );
    expect(result.issues.some((i) => i.kind === "bpm_change")).toBe(true);
    expect(result.metrics.bpm).toBe(120);
  });

  test("flags high density window", () => {
    const notes = Array.from({ length: 30 }, (_, i) => ({
      column: i % 7,
      startMs: 1000 + (i % 10) * 10,
      endMs: 1000 + (i % 10) * 10,
    }));
    const result = analyzeChartTiming(
      chart({ notes }),
      { densityWarnThreshold: 20 },
    );
    expect(result.metrics.peakNotesPerBeat).toBeGreaterThanOrEqual(20);
    expect(result.issues.some((i) => i.kind === "high_density")).toBe(true);
  });
});

describe("compareNotesToBeatGrid", () => {
  test("flags notes far from detected beats", () => {
    const beats = [0, 500, 1000, 1500];
    const issues = compareNotesToBeatGrid([2000, 2010], beats, 35);
    expect(issues.length).toBeGreaterThan(0);
  });
});
