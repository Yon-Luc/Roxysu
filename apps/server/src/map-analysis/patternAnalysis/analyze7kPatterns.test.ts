import { describe, expect, test } from "bun:test";
import { analyze7kNotes } from "./analyze7kPatterns";
import type { ChartNote } from "./types";

function note(column: number, startMs: number, endMs = startMs): ChartNote {
  return { column, startMs, endMs };
}

describe("analyze7kNotes", () => {
  test("detects jack-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 20; i += 1) {
      notes.push(note(3, 1000 + i * 80));
    }
    const result = analyze7kNotes(notes);
    expect(result.dominantPattern).toBe("jack");
    expect(result.jackDensity).toBeGreaterThan(0.5);
  });

  test("detects bracket-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 16; i += 1) {
      const t = 1000 + i * 100;
      notes.push(note(0, t), note(6, t));
    }
    const result = analyze7kNotes(notes);
    expect(result.dominantPattern).toBe("bracket");
    expect(result.bracketDensity).toBeGreaterThan(0.5);
  });

  test("detects jumpstream-dominant chart", () => {
    const notes: ChartNote[] = [];
    const cols = [1, 3, 5, 2, 4, 0, 6, 3];
    for (let i = 0; i < cols.length * 4; i += 1) {
      notes.push(note(cols[i % cols.length]!, 1000 + i * 60));
    }
    const result = analyze7kNotes(notes);
    expect(["jumpstream", "stream", "chordstream"]).toContain(
      result.dominantPattern,
    );
    expect(result.streamDensity).toBeGreaterThan(0.3);
  });

  test("detects chordjack-dominant chart", () => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < 12; i += 1) {
      const t = 1000 + i * 90;
      notes.push(note(2, t), note(4, t));
    }
    const result = analyze7kNotes(notes);
    expect(["chordjack", "chordstream", "jack"]).toContain(
      result.dominantPattern,
    );
    expect(result.chordDensity).toBeGreaterThan(0.5);
  });

  test("returns mixed for sparse charts", () => {
    const notes = [note(0, 0), note(3, 5000), note(6, 10000)];
    const result = analyze7kNotes(notes);
    expect(result.dominantPattern).toBe("mixed");
  });
});
