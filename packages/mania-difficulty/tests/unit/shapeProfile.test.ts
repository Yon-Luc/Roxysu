import { describe, expect, test } from "bun:test";
import { skillProfile } from "../../src/skillProfile";
import { shapeProfile } from "../../src/shapeProfile";
import { SHAPE_LABELS, isShapeLabel } from "../../src/shape";
import type { ManiaBeatmapInput, ManiaDifficultyNote } from "../../src/types";

function chart(columnCount: number, rows: number[][], gapMs = 120): ManiaBeatmapInput {
  // The difficulty graph drops the first note. A lead-in keeps the pattern rows intact.
  const notes: ManiaDifficultyNote[] = [
    { column: 0, startMs: 0, endMs: 0 },
  ];
  rows.forEach((cols, i) => {
    const startMs = 200 + i * gapMs;
    for (const column of cols) notes.push({ column, startMs, endMs: startMs });
  });
  return { columnCount, overallDifficulty: 8, notes };
}

function repeat(pattern: number[][], times: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < times; i++) rows.push(...pattern);
  return rows;
}

describe("shapeProfile", () => {
  test("an empty chart has no shape", () => {
    const shape = shapeProfile({
      columnCount: 4,
      overallDifficulty: 8,
      notes: [],
    });
    expect(shape.dominant).toBeNull();
    expect(shape.jumpstreamScore).toBe(0);
  });

  test("a two-column alternation is a trill", () => {
    const rows = repeat([[0], [1]], 16);
    expect(shapeProfile(chart(4, rows)).dominant).toBe("trill");
  });

  test("recurring two-note jumps are a jumptrill", () => {
    const rows = repeat(
      [
        [0, 1],
        [2, 3],
      ],
      16,
    );
    expect(shapeProfile(chart(4, rows)).dominant).toBe("jumptrill");
  });

  test("jumps beside singles are jumpstream", () => {
    const cycle = [
      [0, 1],
      [3],
      [1, 2],
      [0],
      [2, 3],
      [1],
    ];
    const shape = shapeProfile(chart(4, repeat(cycle, 8)));
    expect(shape.dominant).toBe("jumpstream");
    expect(shape.jumpstreamScore).toBeGreaterThan(0);
  });

  test("7k jumps beside singles are not jumpstream or chordstream", () => {
    const cycle = [
      [0, 1],
      [3],
      [1, 2],
      [0],
      [2, 3],
      [1],
    ];
    const shape = shapeProfile(chart(7, repeat(cycle, 8)));
    expect(shape.counts.jumpstream).toBe(0);
    // A 2-note chord is not a chordstream outside 4K — those rows stay
    // unlabeled, and the singles between them read as single-note stream.
    expect(shape.counts.chordstream).toBe(0);
    expect(shape.dominant).toBe("stream");
  });

  test("chords that share a column are chordjacks", () => {
    const rows = repeat(
      [
        [0, 1],
        [1, 2],
      ],
      12,
    );
    const shape = shapeProfile(chart(4, rows));
    expect(shape.dominant).toBe("chordjack");
    expect(shape.chordjackScore).toBeGreaterThan(0.5);
  });

  test("chords with no shared column are chordstream", () => {
    const rows = repeat(
      [
        [0, 1, 2],
        [3, 4, 5],
      ],
      12,
    );
    const shape = shapeProfile(chart(7, rows));
    expect(shape.dominant).toBe("chordstream");
    expect(shape.chordstreamScore).toBeGreaterThan(0);
  });

  test("dense non-rolling 7k chords are brackets", () => {
    const triple = [
      [0, 1, 2, 3],
      [4, 5, 6],
      [0, 1, 2],
    ];
    expect(shapeProfile(chart(7, repeat(triple, 10))).dominant).toBe("bracket");
  });

  test("4k size-3 chords with no jack are handstream", () => {
    const rows = repeat(
      [
        [1, 2, 3],
        [0],
      ],
      12,
    );
    expect(shapeProfile(chart(4, rows)).dominant).toBe("handstream");
  });

  test("7k size-3 chords beside singles are chordstream, never handstream", () => {
    const rows = repeat(
      [
        [0, 1, 2],
        [3],
      ],
      12,
    );
    const shape = shapeProfile(chart(7, rows));
    expect(shape.counts.handstream).toBe(0);
    expect(shape.dominant).toBe("chordstream");
  });

  test("4k chords are never bracket", () => {
    const rows = repeat(
      [
        [0, 1, 2, 3],
        [1, 2, 3],
        [0, 1, 2, 3],
      ],
      8,
    );
    const shape = shapeProfile(chart(4, rows));
    expect(shape.counts.bracket).toBe(0);
    expect(shape.dominant).toBe("chordjack");
  });

  test("a speed-dominant jumpstream keeps both labels", () => {
    const cycle = [
      [0, 1],
      [3],
      [1, 2],
      [0],
      [2, 3],
      [1],
    ];
    const beatmap = chart(4, repeat(cycle, 16), 200);
    const skills = skillProfile(beatmap, { windowMs: null });
    const shape = skills.attributes.shape;
    expect(skills.dominant).toBe("speed");
    expect(shape?.dominant).toBe("jumpstream");
  });

  test("isShapeLabel accepts families and rejects skill names", () => {
    for (const shape of SHAPE_LABELS) expect(isShapeLabel(shape)).toBe(true);
    expect(isShapeLabel("speed")).toBe(false);
    expect(isShapeLabel("jack")).toBe(false);
  });
});
