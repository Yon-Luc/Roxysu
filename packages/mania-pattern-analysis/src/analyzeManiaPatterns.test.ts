import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChartNote } from "@roxysu/osu-chart";
import {
  analyzeManiaFromOsuText,
  analyzeManiaStructuralNotes,
  findAllPatternsFromOsuFile,
  PATTERN_ALGORITHM,
} from "./index.js";

function note(column: number, startMs: number, endMs = startMs): ChartNote {
  return { column, startMs, endMs };
}

describe("analyzeManiaStructuralNotes", () => {
  test("analyzes 4K charts with key-specific recognisers", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 24; i += 1) {
      notes.push(note(i % 4, 1000 + i * 70));
    }
    const result = analyzeManiaStructuralNotes(notes, 4);
    expect(result.columnCount).toBe(4);
    expect(result.dominantPattern).not.toBe("");
    expect(result.interludeCategory).not.toBe("Unknown");
  });

  test("analyzes 7K charts without 7K-only restrictions", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 32; i += 1) {
      notes.push(note(i % 7, 1000 + i * 65));
    }
    const result = analyzeManiaStructuralNotes(notes, 7);
    expect(result.columnCount).toBe(7);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.interludeCategory).not.toBe("Unknown");
  });
});

describe("analyzeManiaFromOsuText", () => {
  test("parses sample.osu and returns Roxysu metrics", () => {
    const samplePath = join(import.meta.dir, "..", "sample.osu");
    const osuText = readFileSync(samplePath, "utf8");
    const result = analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM);
    expect(result.columnCount).toBeGreaterThan(0);
    expect(result.dominantPattern).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  test("findAllPatternsFromOsuFile exposes interlude clusters", () => {
    const samplePath = join(import.meta.dir, "..", "sample.osu");
    const osuText = readFileSync(samplePath, "utf8");
    const result = findAllPatternsFromOsuFile(osuText);
    expect(result.success).toBe(true);
    expect(result.interludeCategory).not.toBe("Unknown");
    expect(result.interludeClusters.length).toBeGreaterThan(0);
  });
});
