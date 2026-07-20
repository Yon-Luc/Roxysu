import { describe, expect, test } from "bun:test";
import type { ChartNote } from "@roxysu/osu-chart";
import { analyze7kHeuristicNotes } from "../src/heuristic-v1/analyze7kHeuristic";
import { analyze7kStructuralNotes } from "../src/structural-v2/analyze7kStructural";

function note(column: number, startMs: number, endMs = startMs): ChartNote {
  return { column, startMs, endMs };
}

describe("analyze7kHeuristicNotes (v1)", () => {
  test("detects jack-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 20; i += 1) {
      notes.push(note(3, 1000 + i * 80));
    }
    const result = analyze7kHeuristicNotes(notes);
    expect(result.dominantPattern).toBe("jack");
    expect(result.jackDensity).toBeGreaterThan(0.5);
  });

  test("detects bracket-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 16; i += 1) {
      const t = 1000 + i * 100;
      notes.push(note(0, t), note(6, t));
    }
    const result = analyze7kHeuristicNotes(notes);
    expect(result.dominantPattern).toBe("bracket");
    expect(result.bracketDensity).toBeGreaterThan(0.5);
  });
});

describe("analyze7kStructuralNotes (v2)", () => {
  test("detects structural jack (3+ same column)", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 20; i += 1) {
      notes.push(note(3, 1000 + i * 80));
    }
    const result = analyze7kStructuralNotes(notes);
    expect(result.dominantPattern).toBe("jack");
    expect(result.jackDensity).toBeGreaterThan(0.5);
    expect(result.composition.jack).toBeGreaterThan(0.5);
  });

  test("detects delay-dominant chart (7k stream)", () => {
    const notes: ChartNote[] = [];
    const cols = [1, 3, 5, 2, 4, 0, 6, 3];
    for (let i = 0; i < cols.length * 4; i += 1) {
      notes.push(note(cols[i % cols.length]!, 1000 + i * 60));
    }
    const result = analyze7kStructuralNotes(notes);
    expect(["delay", "chordstream"]).toContain(result.dominantPattern);
    expect(result.streamDensity).toBeGreaterThan(0.2);
  });

  test("detects bracket-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 16; i += 1) {
      const t = 1000 + i * 100;
      notes.push(note(0, t), note(6, t));
    }
    const result = analyze7kStructuralNotes(notes);
    expect(result.dominantPattern).toBe("bracket");
    expect(result.bracketDensity).toBeGreaterThan(0.5);
  });

  test("detects chordjack-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 12; i += 1) {
      const t = 1000 + i * 90;
      notes.push(note(1, t), note(3, t));
      notes.push(note(1, t + 45), note(3, t + 45));
      notes.push(note(1, t + 90));
    }
    const result = analyze7kStructuralNotes(notes);
    expect(["chordjack", "jack", "chordstream"]).toContain(
      result.dominantPattern,
    );
    expect(result.chordDensity).toBeGreaterThan(0.3);
  });

  test("returns mixed for sparse charts", () => {
    const notes = [note(0, 0), note(3, 5000), note(6, 10000)];
    const result = analyze7kStructuralNotes(notes);
    expect(result.dominantPattern).toBe("mixed");
  });

  test("produces section breakdown", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 40; i += 1) {
      notes.push(note(3, 1000 + i * 80));
    }
    const result = analyze7kStructuralNotes(notes);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections[0]!.patterns.length).toBeGreaterThan(0);
  });
});
