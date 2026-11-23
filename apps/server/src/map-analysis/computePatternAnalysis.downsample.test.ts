import { describe, expect, test } from "bun:test";
import {
  downsampleDensitySamples,
  type SevenKDensitySample,
} from "./computePatternAnalysis";

function sample(
  index: number,
  notesPerSecond = 1,
  peakChordSize = 1,
): SevenKDensitySample {
  return {
    startMs: index * 1000,
    endMs: index * 1000 + 1000,
    midpointMs: index * 1000 + 500,
    noteCount: Math.round(notesPerSecond),
    notesPerSecond,
    peakChordSize,
    dominantPattern: null,
    secondaryPattern: null,
    composition: {} as SevenKDensitySample["composition"],
  };
}

describe("downsampleDensitySamples", () => {
  test("returns every sample when already within the cap", () => {
    const samples = [sample(0), sample(1), sample(2)];
    expect(downsampleDensitySamples(samples, 120)).toBe(samples);
  });

  test("keeps the loudest sample in each bin instead of an index stride", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => sample(i));
    samples[333] = sample(333, 20);
    const out = downsampleDensitySamples(samples, 100);
    expect(out.length).toBe(100);
    expect(out.some((s) => s.startMs === 333_000)).toBe(true);
    // A plain index stride (0, 10, 20, …) would have missed it.
    expect(out.map((s) => s.startMs)).not.toContain(330_000);
  });

  test("breaks NPS ties on peak chord size and preserves order", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => sample(i));
    samples[500] = sample(500, 1, 4);
    samples[505] = sample(505, 1, 6);
    const out = downsampleDensitySamples(samples, 100);
    expect(out.find((s) => s.startMs === 505_000)?.peakChordSize).toBe(6);
    const times = out.map((s) => s.startMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });
});
