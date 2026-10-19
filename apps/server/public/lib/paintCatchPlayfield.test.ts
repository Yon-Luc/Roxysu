import { describe, expect, test } from "bun:test";
import * as paint from "./paintCatchPlayfield";
import {
  buildCatchComboInfo,
  circleSizeScale,
  dropletDiameter,
  fruitDiameter,
  fruitKindForIndex,
  type CatchHitObject,
} from "./paintCatchPlayfield";

describe("buildCatchComboInfo", () => {
  test("advances colour index on newCombo with comboOffset", () => {
    const objects: CatchHitObject[] = [
      {
        type: "fruit",
        x: 0,
        timeMs: 0,
        hyperDash: false,
        newCombo: true,
        indexInBeatmap: 0,
      },
      {
        type: "fruit",
        x: 0,
        timeMs: 100,
        hyperDash: false,
        indexInBeatmap: 1,
      },
      {
        type: "fruit",
        x: 0,
        timeMs: 200,
        hyperDash: false,
        newCombo: true,
        comboOffset: 1,
        indexInBeatmap: 2,
      },
      { type: "droplet", x: 0, timeMs: 150, kind: "tiny" },
      {
        type: "fruit",
        x: 0,
        timeMs: 300,
        hyperDash: false,
        indexInBeatmap: 3,
      },
    ];
    const info = buildCatchComboInfo(objects);
    expect(info.numbers[0]).toBe(1);
    expect(info.colourIndexes[0]).toBe(0);
    expect(info.numbers[1]).toBe(2);
    expect(info.colourIndexes[1]).toBe(0);
    expect(info.numbers[2]).toBe(1);
    expect(info.colourIndexes[2]).toBe(2); // +1 + offset 1
    expect(info.numbers[4]).toBe(2);
    expect(info.colourIndexes[4]).toBe(2);
  });
});

describe("fruitKindForIndex", () => {
  test("cycles pear grapes apple orange", () => {
    expect(fruitKindForIndex(0)).toBe("pear");
    expect(fruitKindForIndex(1)).toBe("grapes");
    expect(fruitKindForIndex(2)).toBe("apple");
    expect(fruitKindForIndex(3)).toBe("orange");
    expect(fruitKindForIndex(4)).toBe("pear");
  });
});

describe("catch object size", () => {
  test("CS 5 fruit diameter is 64 osu pixels", () => {
    expect(circleSizeScale(5)).toBe(0.5);
    expect(fruitDiameter(5)).toBe(64);
    expect(dropletDiameter(5)).toBe(16);
    expect(dropletDiameter(5, true)).toBe(8);
  });

  test("does not export a hyperdash connector", () => {
    expect("nextHyperFruit" in paint).toBe(false);
  });
});
