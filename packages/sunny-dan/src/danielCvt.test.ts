import { describe, expect, test } from "bun:test";
import { runDanielEstimatorFromText } from "./danielEstimator";
import { runSunnyEstimatorFromText } from "./sunnyEstimator";
import { LN_DAN_RATIO_THRESHOLD } from "./estDiff";

/** 4K rice stream: one note per column per beat so Invert yields LNs. */
function fourKRiceOsuText(): string {
  const lines = [
    "osu file format v14",
    "[General]",
    "Mode: 3",
    "[Metadata]",
    "Title: cvt fixture",
    "Artist: tester",
    "Version: 4K",
    "[Difficulty]",
    "CircleSize: 4",
    "OverallDifficulty: 8",
    "[TimingPoints]",
    "0,500,4,2,0,60,1,0",
    "[HitObjects]",
  ];
  let t = 0;
  for (let i = 0; i < 16; i += 1) {
    const col = i % 4;
    const x = col * 128 + 64;
    lines.push(`${x},192,${t},1,0,0:0:0:0:`);
    t += 500;
  }
  return lines.join("\n");
}

describe("Daniel estimator pattern conversions", () => {
  test("base chart is pure rice", () => {
    const base = runDanielEstimatorFromText(fourKRiceOsuText());
    expect(base.columnCount).toBe(4);
    expect(base.lnRatio).toBe(0);
  });

  test("cvtFlag IN converts the 4K chart to full-LN", () => {
    const text = fourKRiceOsuText();
    const inverted = runDanielEstimatorFromText(text, { cvtFlag: "IN" });
    // Trailing note per column is dropped; every remaining note is an LN.
    expect(inverted.lnRatio).toBe(1);
    expect(inverted.estDiff).toBeTruthy();
    // LN ratio crosses the 20% threshold → LN dan table instead of RC.
    expect(inverted.lnRatio).toBeGreaterThanOrEqual(LN_DAN_RATIO_THRESHOLD);
    expect(Number.isFinite(inverted.star)).toBe(true);
  });

  test("cvtFlag IN then HO nets back to rice", () => {
    const text = fourKRiceOsuText();
    const both = runDanielEstimatorFromText(text, { cvtFlag: "IN,HO" });
    expect(both.lnRatio).toBe(0);
  });
});

describe("Sunny estimator pattern conversions", () => {
  test("cvtFlag IN raises the LN ratio on a rice chart", () => {
    const text = fourKRiceOsuText();
    const base = runSunnyEstimatorFromText(text);
    const inverted = runSunnyEstimatorFromText(text, { cvtFlag: "IN" });
    expect(base.lnRatio).toBe(0);
    expect(inverted.lnRatio).toBe(1);
  });
});
