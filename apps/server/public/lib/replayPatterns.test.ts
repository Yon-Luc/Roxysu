import { describe, expect, test } from "bun:test";
import {
  analyzeMissPatterns,
  computeColumnHeat,
  computeTimingStats,
  summarizePatternTags,
} from "./replayPatterns";

describe("analyzeMissPatterns", () => {
  test("tags jack, chord, and LN drop", () => {
    const notes = [
      { column: 0, startMs: 1000, endMs: 1000 },
      { column: 0, startMs: 1100, endMs: 1100 }, // jack after 100ms
      { column: 1, startMs: 1100, endMs: 1100 }, // chord with previous
      { column: 2, startMs: 2000, endMs: 2500 }, // LN
    ];
    const judgments = [
      {
        noteIndex: 1,
        tMs: 1100,
        result: "miss",
        errorMs: null,
        isTail: false,
      },
      {
        noteIndex: 3,
        tMs: 2500,
        result: "miss",
        errorMs: null,
        isTail: true,
      },
    ];
    const misses = analyzeMissPatterns(notes, judgments);
    expect(misses).toHaveLength(2);
    expect(misses[0]!.tags).toContain("jack");
    expect(misses[0]!.tags).toContain("chord");
    expect(misses[0]!.jackGapMs).toBe(100);
    expect(misses[0]!.chordSize).toBe(2);
    expect(misses[1]!.tags).toContain("ln-drop");
  });

  test("tags LN head on hold miss", () => {
    const notes = [{ column: 0, startMs: 1000, endMs: 2000 }];
    const judgments = [
      {
        noteIndex: 0,
        tMs: 1000,
        result: "miss",
        errorMs: null,
        isTail: false,
      },
    ];
    const misses = analyzeMissPatterns(notes, judgments);
    expect(misses[0]!.tags).toContain("ln-head");
  });
});

describe("computeTimingStats", () => {
  test("computes mean early/late", () => {
    const stats = computeTimingStats([
      { noteIndex: 0, tMs: 0, result: "perfect", errorMs: -5 },
      { noteIndex: 1, tMs: 0, result: "great", errorMs: 5 },
      { noteIndex: 2, tMs: 0, result: "miss", errorMs: null },
    ]);
    expect(stats.count).toBe(2);
    expect(stats.mean).toBe(0);
    expect(stats.earlyPct).toBe(50);
    expect(stats.latePct).toBe(50);
  });
});

describe("computeColumnHeat", () => {
  test("tints only columns with misses", () => {
    const heat = computeColumnHeat(
      [
        { column: 0, startMs: 0, endMs: 0 },
        { column: 1, startMs: 100, endMs: 100 },
      ],
      [
        {
          noteIndex: 0,
          tMs: 0,
          result: "miss",
          errorMs: null,
          isTail: false,
        },
        {
          noteIndex: 1,
          tMs: 100,
          result: "perfect",
          errorMs: 20,
          isTail: false,
        },
      ],
      2,
    );
    expect(heat[0]!.missCount).toBe(1);
    expect(heat[0]!.intensity).toBe(1);
    expect(heat[1]!.intensity).toBe(0);
  });

  test("leaves clean plays untinted", () => {
    const heat = computeColumnHeat(
      [
        { column: 0, startMs: 0, endMs: 0 },
        { column: 1, startMs: 100, endMs: 100 },
      ],
      [
        {
          noteIndex: 0,
          tMs: 0,
          result: "perfect",
          errorMs: 8,
          isTail: false,
        },
        {
          noteIndex: 1,
          tMs: 100,
          result: "great",
          errorMs: 12,
          isTail: false,
        },
      ],
      2,
    );
    expect(heat.every((c) => c.intensity === 0)).toBe(true);
  });
});

describe("summarizePatternTags", () => {
  test("counts tags", () => {
    const counts = summarizePatternTags([
      {
        noteIndex: 0,
        tMs: 0,
        column: 0,
        isTail: false,
        result: "miss",
        tags: ["jack", "chord"],
        jackGapMs: 80,
        chordSize: 2,
      },
    ]);
    expect(counts.jack).toBe(1);
    expect(counts.chord).toBe(1);
    expect(counts.stream).toBe(0);
  });
});
