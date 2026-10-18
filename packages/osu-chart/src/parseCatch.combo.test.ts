import { describe, expect, test } from "bun:test";
import { parseCatchChart } from "./parseCatch";

const COMBO_CATCH = `osu file format v14

[General]
Mode: 2

[Difficulty]
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Colours]
Combo1: 255,0,0
Combo2: 0,255,0
Combo3: #0000ff

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
100,100,1000,5,0,0:0:0:0:
200,100,1200,1,0,0:0:0:0:
300,100,1400,21,0,0:0:0:0:
400,100,1600,1,0,0:0:0:0:
`;

describe("parseCatchChart combo", () => {
  test("preserves comboColors, newCombo, comboOffset, indexInBeatmap", () => {
    const chart = parseCatchChart(COMBO_CATCH);
    expect(chart.status).toBe("OK");
    expect(chart.comboColors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);

    const fruits = chart.hitObjects.filter((o) => o.type === "fruit");
    expect(fruits.length).toBe(4);

    const f0 = fruits[0]!;
    expect(f0.type).toBe("fruit");
    if (f0.type === "fruit") {
      expect(f0.newCombo).toBe(true);
      expect(f0.comboOffset).toBe(0);
      expect(f0.indexInBeatmap).toBe(0);
    }

    const f1 = fruits[1]!;
    if (f1.type === "fruit") {
      expect(f1.newCombo).toBe(false);
      expect(f1.indexInBeatmap).toBe(1);
    }

    // type 21 = circle | new combo | offset 1
    const f2 = fruits[2]!;
    if (f2.type === "fruit") {
      expect(f2.newCombo).toBe(true);
      expect(f2.comboOffset).toBe(1);
      expect(f2.indexInBeatmap).toBe(2);
    }
  });
});
