import { describe, expect, test } from "bun:test";
import { buildStdHitsoundEvents } from "./stdHitsoundPlayer";
import type { StdHitObject, StdSampleTiming } from "@roxysu/osu-chart";

describe("buildStdHitsoundEvents", () => {
  test("emits layered hitnormal + whistle for a circle", () => {
    const objects: StdHitObject[] = [
      {
        type: "circle",
        x: 0,
        y: 0,
        timeMs: 1000,
        stackX: 0,
        stackY: 0,
        hitSound: 2, // whistle
        hitSample: { normalSet: 2, additionSet: 2, index: 0, volume: 80 },
      },
    ];
    const timing: StdSampleTiming[] = [
      { timeMs: 0, sampleSet: 1, sampleIndex: 0, volume: 100 },
    ];
    const events = buildStdHitsoundEvents(objects, timing, true);
    expect(events).toHaveLength(1);
    expect(events[0]!.tMs).toBe(1000);
    const samples = events[0]!.voices.map((v) => v.sample);
    expect(samples).toContain("soft-hitnormal");
    expect(samples).toContain("soft-hitwhistle");
    expect(events[0]!.voices[0]!.volume).toBe(80);
  });

  test("emits slider head, tick, and tail", () => {
    const objects: StdHitObject[] = [
      {
        type: "slider",
        x: 0,
        y: 0,
        timeMs: 500,
        endMs: 1500,
        path: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        repeats: 1,
        pixelLength: 100,
        stackX: 0,
        stackY: 0,
        ticks: [{ frac: 0.5, tMs: 1000 }],
        hitSound: 0,
      },
    ];
    const events = buildStdHitsoundEvents(objects, [], true);
    expect(events.map((e) => e.tMs)).toEqual([500, 1000, 1500]);
    expect(events[1]!.voices[0]!.sample).toBe("normal-slidertick");
  });
});
