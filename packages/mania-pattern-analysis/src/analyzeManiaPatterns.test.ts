import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChartNote } from "@roxysu/osu-chart";
import { SKILL_LABELS } from "@roxysu/mania-difficulty";
import {
  analyzeManiaBackfillFromOsuText,
  analyzeManiaFromOsuText,
  analyzeManiaNotes,
  analyzeManiaSkillNotes,
  analyzeManiaStructuralNotes,
  noteDensities,
  PATTERN_ALGORITHM,
  PATTERN_LABELS,
} from "./index.js";

function note(column: number, startMs: number, endMs = startMs): ChartNote {
  return { column, startMs, endMs };
}

function stream(keyCount: number, count: number, gapMs: number): ChartNote[] {
  return Array.from({ length: count }, (_, i) =>
    note(i % keyCount, 1000 + i * gapMs),
  );
}

describe("pattern algorithm id", () => {
  test("active algorithm is the dominant-skill one", () => {
    expect(PATTERN_ALGORITHM).toBe("mania-skill-v1");
    expect([...PATTERN_LABELS]).toEqual([...SKILL_LABELS]);
  });
});

describe("analyzeManiaSkillNotes", () => {
  test("classifies a chart by its strongest skill", () => {
    const result = analyzeManiaSkillNotes(stream(4, 32, 70), 4);
    expect(result.algorithm).toBe("mania-skill-v1");
    expect(result.columnCount).toBe(4);
    expect(result.dominantPattern).not.toBeNull();
    expect(SKILL_LABELS).toContain(result.dominantPattern!);
    expect(result.starRating).toBeGreaterThan(0);
  });

  test("reports every skill star, highest first", () => {
    const result = analyzeManiaSkillNotes(stream(7, 40, 60), 7);
    expect(result.skillStars).toHaveLength(SKILL_LABELS.length);
    for (let i = 1; i < result.skillStars.length; i += 1) {
      expect(result.skillStars[i - 1]!.star).toBeGreaterThanOrEqual(
        result.skillStars[i]!.star,
      );
    }
  });

  test("secondary is null or a skill label", () => {
    const result = analyzeManiaSkillNotes(stream(4, 30, 80), 4);
    if (result.secondaryPattern != null) {
      expect(SKILL_LABELS).toContain(result.secondaryPattern);
    }
  });

  test("builds time sections covering the chart", () => {
    const result = analyzeManiaSkillNotes(stream(4, 60, 100), 4);
    expect(result.sections.length).toBeGreaterThan(0);
    for (const section of result.sections) {
      expect(section.endMs).toBeGreaterThan(section.startMs);
      for (const p of section.patterns) {
        expect(SKILL_LABELS).toContain(p.label);
        expect(p.coverage).toBeGreaterThan(0);
        expect(p.coverage).toBeLessThanOrEqual(1);
      }
    }
    // sections must be contiguous and ordered
    for (let i = 1; i < result.sections.length; i += 1) {
      expect(result.sections[i]!.startMs).toBeGreaterThanOrEqual(
        result.sections[i - 1]!.endMs,
      );
    }
  });

  test("an explicit null width skips binning entirely", () => {
    const binned = analyzeManiaSkillNotes(stream(7, 600, 80), 7, 8, 2000);
    const result = analyzeManiaSkillNotes(stream(7, 600, 80), 7, 8, null);

    expect(result.sections).toEqual([]);
    expect(binned.sections.length).toBeGreaterThan(0);
    // Chart-level results must survive — the backfill persists exactly these.
    expect(result.dominantPattern).toBe(binned.dominantPattern);
    expect(result.starRating).toBe(binned.starRating);
  });

  test("composition covers all skills and sums to at most 1", () => {
    const result = analyzeManiaSkillNotes(stream(7, 60, 80), 7);
    for (const skill of SKILL_LABELS) {
      expect(result.composition[skill]).toBeTypeOf("number");
    }
    const total = SKILL_LABELS.reduce(
      (sum, s) => sum + (result.composition[s] ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(1.0000001);
    expect(total).toBeGreaterThan(0);
  });

  test("an empty chart has no dominant skill", () => {
    const result = analyzeManiaSkillNotes([], 4);
    expect(result.dominantPattern).toBeNull();
    expect(result.sections).toEqual([]);
    expect(result.starRating).toBe(0);
  });
});

describe("noteDensities", () => {
  test("an empty chart is all zeros", () => {
    const d = noteDensities([]);
    expect(d.chordDensity).toBe(0);
    expect(d.jackDensity).toBe(0);
  });

  test("detects chords and same-column repeats", () => {
    // alternating chord / same-column pair
    const notes = [
      note(0, 0),
      note(1, 0),
      note(1, 200),
      note(2, 200),
      note(1, 400),
      note(2, 400),
    ];
    const d = noteDensities(notes);
    expect(d.chordDensity).toBeCloseTo(1, 10);
    expect(d.jackDensity).toBeGreaterThan(0);
    expect(d.chordstreamScore).toBeCloseTo(1, 10);
  });

  test("a single-column stream is all jacks", () => {
    const d = noteDensities([note(0, 0), note(0, 200), note(0, 400)]);
    expect(d.jackDensity).toBeCloseTo(1, 10);
    expect(d.streamDensity).toBe(0);
  });
});

describe("analyzeManiaFromOsuText", () => {
  test("parses sample.osu with the active algorithm", () => {
    const samplePath = join(import.meta.dir, "..", "sample.osu");
    const osuText = readFileSync(samplePath, "utf8");
    const result = analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM);
    expect(result.columnCount).toBeGreaterThan(0);
    expect(SKILL_LABELS).toContain(result.dominantPattern!);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  test("rejects a retired algorithm id", () => {
    const samplePath = join(import.meta.dir, "..", "sample.osu");
    const osuText = readFileSync(samplePath, "utf8");
    expect(() => analyzeManiaFromOsuText(osuText, "mania-interlude-v1")).toThrow(
      "no longer supported",
    );
  });
});

describe("analyzeManiaBackfillFromOsuText", () => {
  const samplePath = join(import.meta.dir, "..", "sample.osu");
  const osuText = readFileSync(samplePath, "utf8");

  test("returns the same chart-level result as the binning path", () => {
    // The binning pass throws the window array away, so classification must be
    // identical either way — only `sections` differs.
    const binned = analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM);
    const backfill = analyzeManiaBackfillFromOsuText(
      osuText,
      PATTERN_ALGORITHM,
    );

    expect(backfill.dominantPattern).toBe(binned.dominantPattern);
    expect(backfill.secondaryPattern).toBe(binned.secondaryPattern);
    expect(backfill.confidence).toBe(binned.confidence);
    expect(backfill.starRating).toBe(binned.starRating);
    expect(backfill.columnCount).toBe(binned.columnCount);
  });

  test("does not build the timeline a backfill never stores", () => {
    const result = analyzeManiaBackfillFromOsuText(osuText, PATTERN_ALGORITHM);
    expect(result.sections).toEqual([]);
    expect(
      analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM).sections.length,
    ).toBeGreaterThan(0);
  });

  test("rejects a retired algorithm id", () => {
    expect(() => analyzeManiaBackfillFromOsuText(osuText, "mania-interlude-v1"))
      .toThrow("Unknown pattern algorithm");
  });
});

describe("analyzeManiaNotes", () => {
  test("routes to the dominant-skill analysis", () => {
    const result = analyzeManiaNotes(stream(4, 20, 90), 4);
    expect(SKILL_LABELS).toContain(result.dominantPattern!);
  });

  test("rejects an unknown algorithm id", () => {
    expect(() => analyzeManiaNotes([], 4, "nope")).toThrow("Unknown pattern");
  });
});

describe("legacy Interlude adapter", () => {
  test("still classifies charts for reading stored rows", () => {
    const result = analyzeManiaStructuralNotes(stream(4, 24, 70), 4);
    expect(result.algorithm).toBe("mania-interlude-v1");
    expect(result.interludeCategory).not.toBe("Unknown");
  });
});