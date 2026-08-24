import { describe, expect, test } from "bun:test";
import {
  columnNoteType,
  decodeSkinIniBytes,
  defaultKeyImageName,
  defaultNoteImageName,
  importedHitPositionFrac,
  layoutManiaPlayfield,
  parseSkinIni,
  resolveManiaSection,
} from "./osuSkinIni";

const SAMPLE = `
[General]
Name: Test Skin
Author: Roxy

[Mania]
Keys: 7
HitPosition: 420
ColumnWidth: 30,30,30,40,30,30,30
ColumnSpacing: 0,0,0,0,0,0
NoteImage0: n0
NoteImage3: n3
KeyImage0: k0
StageLeft: stage-l
StageRight: stage-r

[Mania]
Keys: 4
HitPosition: 400
ColumnWidth: 45,45,45,45
`;

describe("parseSkinIni", () => {
  test("reads name and multiple mania key sections", () => {
    const parsed = parseSkinIni(SAMPLE);
    expect(parsed.name).toBe("Test Skin");
    expect(parsed.mania.map((s) => s.keys)).toEqual([7, 4]);
    expect(parsed.mania[0]!.hitPosition).toBe(420);
    expect(parsed.mania[0]!.columnWidth[3]).toBe(40);
    expect(parsed.mania[0]!.noteImage[0]).toBe("n0");
    expect(parsed.mania[0]!.noteImage[3]).toBe("n3");
    expect(parsed.mania[0]!.stageLeft).toBe("stage-l");
    expect(parsed.mania[1]!.columnWidth).toEqual([45, 45, 45, 45]);
  });

  test("strips // comments and defaults missing fields", () => {
    const parsed = parseSkinIni(`
[Mania]
Keys: 4 // four key
HitPosition: 402
// ignored
`);
    expect(parsed.mania).toHaveLength(1);
    expect(parsed.mania[0]!.keys).toBe(4);
    expect(parsed.mania[0]!.columnWidth).toHaveLength(4);
    expect(parsed.mania[0]!.columnSpacing).toHaveLength(3);
  });

  test("skips invalid Keys sections", () => {
    const parsed = parseSkinIni(`
[Mania]
Keys: 0
[Mania]
Keys: foo
`);
    expect(parsed.mania).toHaveLength(0);
  });
});

describe("decodeSkinIniBytes", () => {
  test("decodes utf-8", () => {
    expect(decodeSkinIniBytes(new TextEncoder().encode("[General]\nName: A"))).toContain(
      "Name: A",
    );
  });

  test("decodes utf-16le with bom", () => {
    const text = "[General]\nName: Wide";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i += 1) {
      bytes[2 + i * 2] = text.charCodeAt(i);
    }
    expect(decodeSkinIniBytes(bytes)).toContain("Name: Wide");
  });
});

describe("column defaults", () => {
  test("7K special column is center", () => {
    expect(columnNoteType(7, 3)).toBe("S");
    expect(defaultNoteImageName(7, 3)).toBe("mania-noteS");
    expect(defaultNoteImageName(7, 0, "H")).toBe("mania-note1H");
    expect(defaultKeyImageName(4, 1, true)).toBe("mania-key2D");
  });
});

describe("resolveManiaSection", () => {
  test("returns exact Keys section", () => {
    const parsed = parseSkinIni(SAMPLE);
    expect(resolveManiaSection(parsed.mania, 4).keys).toBe(4);
    expect(resolveManiaSection(parsed.mania, 4).hitPosition).toBe(400);
  });

  test("adapts nearest section to another keymode", () => {
    const parsed = parseSkinIni(SAMPLE);
    const adapted = resolveManiaSection(parsed.mania, 6);
    expect(adapted.keys).toBe(6);
    expect(adapted.columnWidth).toHaveLength(6);
    expect(adapted.hitPosition).toBe(420);
  });

  test("synthesizes defaults when no sections exist", () => {
    const section = resolveManiaSection([], 8);
    expect(section.keys).toBe(8);
    expect(section.columnWidth).toHaveLength(8);
    expect(section.stageLeft).toBe("mania-stage-left");
  });
});

describe("layoutManiaPlayfield", () => {
  test("fills canvas width and keeps column ratios", () => {
    const layout = layoutManiaPlayfield({
      canvasW: 400,
      canvasH: 480,
      keys: 4,
      columnWidth: [20, 40, 40, 20],
      columnSpacing: [0, 0, 0],
      hitPositionPx: 402,
    });
    expect(layout.columns).toHaveLength(4);
    const total = layout.columns.reduce((a, c) => a + c.w, 0);
    expect(total).toBeCloseTo(400, 5);
    expect(layout.columns[1]!.w).toBeCloseTo(layout.columns[0]!.w * 2, 5);
    expect(layout.receptorY).toBeCloseTo(402, 5);
    expect(layout.stageLeft).toBeNull();
  });

  test("reserves stage sides", () => {
    const layout = layoutManiaPlayfield({
      canvasW: 400,
      canvasH: 400,
      keys: 4,
      columnWidth: [30, 30, 30, 30],
      columnSpacing: [0, 0, 0],
      hitPositionPx: 400,
      stageLeft: { w: 40, h: 400 },
      stageRight: { w: 40, h: 400 },
    });
    expect(layout.stageLeft?.w).toBeCloseTo(40, 5);
    expect(layout.stageRight?.w).toBeCloseTo(40, 5);
    const total = layout.columns.reduce((a, c) => a + c.w, 0);
    expect(total).toBeCloseTo(320, 5);
    expect(layout.columns[0]!.x).toBeCloseTo(40, 5);
  });

  test("zero spacing matches equal-width flush columns", () => {
    const layout = layoutManiaPlayfield({
      canvasW: 400,
      canvasH: 480,
      keys: 4,
      columnWidth: [1, 1, 1, 1],
      columnSpacing: [0, 0, 0],
      hitPositionPx: 402,
    });
    expect(layout.columns[0]!.x).toBeCloseTo(0, 5);
    expect(layout.columns[0]!.w).toBeCloseTo(100, 5);
    expect(layout.columns[1]!.x).toBeCloseTo(100, 5);
    expect(layout.columns[3]!.x + layout.columns[3]!.w).toBeCloseTo(400, 5);
  });

  test("non-zero spacing opens gaps and shrinks columns", () => {
    const flush = layoutManiaPlayfield({
      canvasW: 400,
      canvasH: 480,
      keys: 4,
      columnWidth: [1, 1, 1, 1],
      columnSpacing: [0, 0, 0],
      hitPositionPx: 402,
    });
    const spaced = layoutManiaPlayfield({
      canvasW: 400,
      canvasH: 480,
      keys: 4,
      columnWidth: [1, 1, 1, 1],
      columnSpacing: [0.2, 0.2, 0.2],
      hitPositionPx: 402,
    });
    expect(spaced.columns[0]!.w).toBeLessThan(flush.columns[0]!.w);
    const gap01 =
      spaced.columns[1]!.x -
      (spaced.columns[0]!.x + spaced.columns[0]!.w);
    expect(gap01).toBeGreaterThan(0);
    expect(gap01).toBeCloseTo(spaced.columns[0]!.w * 0.2, 5);
    const span =
      spaced.columns[3]!.x + spaced.columns[3]!.w - spaced.columns[0]!.x;
    expect(span).toBeCloseTo(400, 5);
  });
});

describe("importedHitPositionFrac", () => {
  test("maps 480-space to a clamped fraction", () => {
    expect(importedHitPositionFrac(402)).toBeCloseTo(402 / 480, 5);
    expect(importedHitPositionFrac(0)).toBeCloseTo(402 / 480, 5);
    expect(importedHitPositionFrac(1000)).toBe(0.98);
  });
});
