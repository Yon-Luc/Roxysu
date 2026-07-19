import { describe, expect, test } from "bun:test";
import { AudioClock } from "./audioClock";

describe("AudioClock", () => {
  test("interpolates between coarse media samples while playing", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });

    // Same media time for several frames — should advance with perf clock.
    clock.observe(1000, { playing: true, rate: 1, now: 0 });
    expect(clock.nowMs(0)).toBe(1000);
    expect(clock.nowMs(8)).toBeCloseTo(1008, 5);
    expect(clock.nowMs(16)).toBeCloseTo(1016, 5);

    // Media clock finally ticks — resync.
    clock.observe(1020, { playing: true, rate: 1, now: 20 });
    expect(clock.nowMs(20)).toBe(1020);
    expect(clock.nowMs(28)).toBeCloseTo(1028, 5);
  });

  test("respects playbackRate", () => {
    const clock = new AudioClock();
    clock.set(0, { playing: true, rate: 1.5, now: 0 });
    expect(clock.nowMs(10)).toBeCloseTo(15, 5);
  });

  test("freezes when paused", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    expect(clock.nowMs(10)).toBeCloseTo(510, 5);

    clock.observe(500, { playing: false, rate: 1, now: 10 });
    expect(clock.nowMs(10)).toBe(500);
    expect(clock.nowMs(50)).toBe(500);
  });

  test("seek set jumps immediately", () => {
    const clock = new AudioClock();
    clock.set(100, { playing: true, rate: 1, now: 0 });
    clock.set(5000, { playing: true, rate: 1, now: 50 });
    expect(clock.nowMs(50)).toBe(5000);
    expect(clock.nowMs(60)).toBeCloseTo(5010, 5);
  });

  test("rate change keeps continuity", () => {
    const clock = new AudioClock();
    clock.set(0, { playing: true, rate: 1, now: 0 });
    expect(clock.nowMs(20)).toBeCloseTo(20, 5);

    clock.observe(0, { playing: true, rate: 2, now: 20 });
    // Continues from interpolated 20ms at new rate.
    expect(clock.nowMs(20)).toBeCloseTo(20, 5);
    expect(clock.nowMs(30)).toBeCloseTo(40, 5);
  });
});
