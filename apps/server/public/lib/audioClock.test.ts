import { describe, expect, test } from "bun:test";
import { AudioClock, createUiTimePublisher } from "./audioClock";

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
    // Freezes at the interpolated time; the coarse media sample (usually one
    // step behind) does not pull the position back.
    expect(clock.nowMs(10)).toBe(510);
    expect(clock.nowMs(50)).toBe(510);
  });

  test("pause still jumps on a large media change", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    clock.observe(500, { playing: false, rate: 1, now: 10 });
    expect(clock.nowMs(10)).toBe(510);

    // A seek while paused (large jump) is a real position change.
    clock.observe(100, { playing: false, rate: 1, now: 20 });
    expect(clock.nowMs(20)).toBe(100);
  });

  test("resume holds until the media pointer advances", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    clock.observe(480, { playing: false, rate: 1, now: 20 });
    expect(clock.nowMs(30)).toBe(520);

    // play() fired but media still reports the paused / rewound position.
    clock.observe(480, { playing: true, rate: 1, now: 30 });
    // Media stuck below the held position, several frames later.
    clock.observe(480, { playing: true, rate: 1, now: 100 });
    expect(clock.nowMs(40)).toBe(520);
    expect(clock.nowMs(120)).toBe(520);

    // Media pointer reaches the held position — playback continues from it.
    clock.observe(520, { playing: true, rate: 1, now: 140 });
    expect(clock.nowMs(140)).toBe(520);
    expect(clock.nowMs(150)).toBeCloseTo(530, 5);
  });

  test("resume hold times out and follows media again", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    clock.observe(480, { playing: false, rate: 1, now: 20 });
    clock.observe(480, { playing: true, rate: 1, now: 30 });
    expect(clock.nowMs(100)).toBe(520);

    // Held longer than RESUME_HOLD_MS while media never moved: follow media.
    clock.observe(480, { playing: true, rate: 1, now: 400 });
    expect(clock.nowMs(400)).toBe(480);
    expect(clock.nowMs(410)).toBeCloseTo(490, 5);
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

describe("createUiTimePublisher", () => {
  test("throttles publishes and flushes when forced", () => {
    const seen: number[] = [];
    const publish = createUiTimePublisher((ms) => seen.push(ms), 100);
    publish(0);
    publish(10);
    publish(20);
    expect(seen).toEqual([0]);
    publish(50, true);
    expect(seen).toEqual([0, 50]);
  });
});
