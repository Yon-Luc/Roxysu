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

/** Tap, then a hold in the same column on the next row. */
function shielded(columnCount: number, times: number, gapMs = 120): ManiaBeatmapInput {
  const notes: ManiaDifficultyNote[] = [
    { column: 0, startMs: 0, endMs: 0 },
  ];
  for (let i = 0; i < times; i++) {
    const tap = 200 + i * gapMs * 2;
    const head = tap + gapMs;
    notes.push({ column: 0, startMs: tap, endMs: tap });
    notes.push({ column: 0, startMs: head, endMs: head + gapMs * 2 });
  }
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
    // Rotate the shared column so no single column is planted — that chart
    // is an anchor, not a chordjack.
    const rows = repeat(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [0, 3],
      ],
      8,
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

  test("a planted column inside chordjacks is an anchor", () => {
    const rows = repeat(
      [
        [0, 1],
        [0, 2],
      ],
      16,
    );
    const shape = shapeProfile(chart(4, rows));
    expect(shape.dominant).toBe("anchor");
    expect(shape.secondary).toBe("chordjack");
    expect(shape.counts.anchor).toBeGreaterThan(0);
  });

  test("a one-column jack run is an anchor, not tech", () => {
    const shape = shapeProfile(chart(4, repeat([[1]], 24)));
    expect(shape.dominant).toBe("anchor");
    expect(shape.dominant).not.toBe("tech");
  });

  test("a short anchor burst inside jumpstream stays jumpstream", () => {
    const burst = [
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const jumpstream = [
      [0, 1],
      [3],
      [1, 2],
      [0],
      [2, 3],
      [1],
    ];
    const shape = shapeProfile(chart(4, [...burst, ...repeat(jumpstream, 8)]));
    expect(shape.dominant).toBe("jumpstream");
    expect(shape.counts.anchor).toBeGreaterThan(0);
  });

  test("7k planted column is an anchor too", () => {
    const rows = repeat(
      [
        [0, 1],
        [0, 4],
      ],
      12,
    );
    const shape = shapeProfile(chart(7, rows));
    expect(shape.dominant).toBe("anchor");
    expect(shape.counts.handstream).toBe(0);
  });

  test("holds preceded by a same-column note are shields", () => {
    const shape = shapeProfile(shielded(4, 16));
    expect(shape.dominant).toBe("shield");
  });

  test("a rice chart is not a shield", () => {
    const rows = repeat([[0], [1], [2], [3]], 8);
    expect(shapeProfile(chart(4, rows)).dominant).not.toBe("shield");
  });

  test("a mix with no leading family is tech", () => {
    const stream = [[0], [2], [1], [3]];
    const trill = [[0], [1]];
    const chordjack = [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
    ];
    const rows = [
      ...repeat(trill, 8),
      ...repeat(stream, 6),
      ...repeat(chordjack, 4),
      ...repeat(trill, 4),
    ];
    const shape = shapeProfile(chart(4, rows));
    expect(shape.dominant).toBe("tech");
    expect(shape.secondary).not.toBeNull();
  });
});
