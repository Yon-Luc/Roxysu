import { describe, expect, test } from "bun:test";
import { parseBeatmapComboColors, parseStdChart } from "./parseStd";

const COMBO_MAP = `osu file format v14

[General]
Mode: 0

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
256,192,2000,12,0,2500
150,150,2600,1,0,0:0:0:0:
`;

describe("parseBeatmapComboColors", () => {
  test("parses RGB and hex ComboN entries", () => {
    const colors = parseBeatmapComboColors(COMBO_MAP.split(/\r?\n/));
    expect(colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });
});

describe("parseStdChart combo flags", () => {
  test("preserves newCombo and comboOffset on circles", () => {
    const chart = parseStdChart(COMBO_MAP);
    expect(chart.status).toBe("OK");
    expect(chart.comboColors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);

    const c0 = chart.hitObjects[0]!;
    expect(c0.type).toBe("circle");
    if (c0.type === "circle") {
      expect(c0.newCombo).toBe(true);
      expect(c0.comboOffset).toBe(0);
    }

    const c1 = chart.hitObjects[1]!;
    expect(c1.type).toBe("circle");
    if (c1.type === "circle") {
      expect(c1.newCombo).toBe(false);
      expect(c1.comboOffset).toBe(0);
    }

    // type 21 = 1 | 4 | 16 → circle + new combo + offset 1
    const c2 = chart.hitObjects[2]!;
    expect(c2.type).toBe("circle");
    if (c2.type === "circle") {
      expect(c2.newCombo).toBe(true);
      expect(c2.comboOffset).toBe(1);
    }
  });
});
