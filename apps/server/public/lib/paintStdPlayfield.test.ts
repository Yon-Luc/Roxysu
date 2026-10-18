import { describe, expect, test } from "bun:test";
import {
  bounceFracAt,
  buildComboInfo,
  darkenHex,
  followPointAngle,
  followPointPositions,
  objectEndPos,
  paintStdPlayfield,
  snakeFracAt,
  type StdHitObject,
} from "./paintStdPlayfield";

function circle(
  timeMs: number,
  opts?: { newCombo?: boolean; comboOffset?: number; x?: number; y?: number },
): StdHitObject {
  const x = opts?.x ?? 100;
  const y = opts?.y ?? 100;
  return {
    type: "circle",
    x,
    y,
    timeMs,
    stackX: x,
    stackY: y,
    newCombo: opts?.newCombo,
    comboOffset: opts?.comboOffset,
  };
}

describe("buildComboInfo", () => {
  test("resets combo number on new combo and after spinner", () => {
    const objects: StdHitObject[] = [
      circle(1000, { newCombo: true }),
      circle(1100),
      circle(1200, { newCombo: true }),
      { type: "spinner", timeMs: 1500, endMs: 2000 },
      circle(2100),
    ];
    const info = buildComboInfo(objects);
    expect(info.numbers).toEqual([1, 2, 1, 0, 1]);
  });

  test("advances colour index with comboOffset", () => {
    const objects: StdHitObject[] = [
      circle(1000, { newCombo: true }),
      circle(1100),
      circle(1200, { newCombo: true, comboOffset: 1 }),
      circle(1300),
    ];
    const info = buildComboInfo(objects);
    // colour starts -1; first new → 0; second new + offset 1 → 0+1+1 = 2
    expect(info.colourIndexes).toEqual([0, 0, 2, 2]);
    expect(info.numbers).toEqual([1, 2, 1, 2]);
  });
});

describe("followPointPositions / followPointAngle", () => {
  test("returns empty when objects are too close", () => {
    expect(followPointPositions({ x: 0, y: 0 }, { x: 20, y: 0 })).toEqual([]);
  });

  test("spaces points along the segment", () => {
    const pts = followPointPositions({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0]!.x).toBeGreaterThan(0);
    expect(pts[pts.length - 1]!.x).toBeLessThan(200);
  });

  test("angle faces along axis-aligned segments", () => {
    expect(followPointAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(followPointAngle({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(
      Math.PI / 2,
    );
    expect(followPointAngle({ x: 100, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(
      Math.PI,
    );
  });
});

describe("darkenHex", () => {
  test("darkens combo red for slider body fill", () => {
    expect(darkenHex("#ff0000", 0.35)).toBe("#590000");
  });
});

describe("paintStdPlayfield resilience", () => {
  test("broken sprites do not blank the playfield", () => {
    const ops: string[] = [];
    const ctx = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "",
      lineJoin: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      clearRect: () => ops.push("clear"),
      fillRect: () => ops.push("fillRect"),
      strokeRect: () => ops.push("strokeRect"),
      beginPath: () => ops.push("begin"),
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => ops.push("arc"),
      stroke: () => ops.push("stroke"),
      fill: () => ops.push("fill"),
      fillText: () => ops.push("text"),
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      setTransform: () => undefined,
      drawImage: () => {
        throw new Error("closed bitmap");
      },
    };
    const objs = [
      circle(1000, { newCombo: true }),
    ];
    // Should not throw; should still draw procedural arcs after sprite failure.
    paintStdPlayfield({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      width: 512,
      height: 384,
      tMs: 900,
      hitObjects: objs,
      circleSize: 4,
      approachRate: 7,
      skin: {
        comboColors: ["#ff0000"],
        sliderTrack: "#fff",
        sliderFill: "#000",
        sliderBall: "#fff",
        spinner: "#fff",
        approach: "#ffffff",
        cursor: "#fff",
        trail: "#fff",
        hitCircleScale: 1,
        showComboNumbers: true,
        showSliderTicks: true,
        showFollowCircle: true,
        showHitPopups: true,
        imported: { name: "broken" },
      },
      sprites: {
        // Invalid drawable — drawImage will throw
        hitcircle: {} as CanvasImageSource,
        approachcircle: {} as CanvasImageSource,
      },
      comboInfo: buildComboInfo(objs),
    });
    expect(ops).toContain("clear");
    expect(ops).toContain("arc");
    expect(ops).toContain("fill");
  });
});

describe("snakeFracAt / bounceFracAt / objectEndPos", () => {
  test("snake completes at hit time", () => {
    expect(snakeFracAt(0, 1000, 1000)).toBe(0);
    expect(snakeFracAt(500, 1000, 1000)).toBeCloseTo(0.5);
    expect(snakeFracAt(1000, 1000, 1000)).toBe(1);
    expect(snakeFracAt(1200, 1000, 1000)).toBe(1);
  });

  test("bounceFracAt reverses on odd spans", () => {
    expect(bounceFracAt(0, 2)).toBe(0);
    expect(bounceFracAt(0.25, 2)).toBeCloseTo(0.5);
    expect(bounceFracAt(0.5, 2)).toBeCloseTo(1);
    expect(bounceFracAt(0.75, 2)).toBeCloseTo(0.5);
    expect(bounceFracAt(1, 2)).toBeCloseTo(0);
  });

  test("objectEndPos for odd/even slider repeats", () => {
    const slider: StdHitObject = {
      type: "slider",
      x: 0,
      y: 0,
      timeMs: 0,
      endMs: 1000,
      repeats: 1,
      pixelLength: 100,
      stackX: 0,
      stackY: 0,
      path: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      ticks: [],
    };
    expect(objectEndPos(slider)).toEqual({ x: 100, y: 0 });
    expect(objectEndPos({ ...slider, repeats: 2 })).toEqual({ x: 0, y: 0 });
  });
});
