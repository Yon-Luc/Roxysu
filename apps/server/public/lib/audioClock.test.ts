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

    // Seek lock from set() is still active, so a far sample is stale.
    clock.observe(100, { playing: false, rate: 1, now: 20 });
    expect(clock.nowMs(20)).toBe(510);

    // After the lock, a large jump while paused is a real position change.
    clock.observe(100, { playing: false, rate: 1, now: 450 });
    expect(clock.nowMs(450)).toBe(100);
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

  test("resume hold times out without snapping backward", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    clock.observe(480, { playing: false, rate: 1, now: 20 });
    clock.observe(480, { playing: true, rate: 1, now: 30 });
    expect(clock.nowMs(100)).toBe(520);

    // Held longer than RESUME_HOLD_MS while media never caught up: keep the
    // frozen time and interpolate forward. Do not adopt the lagging sample.
    clock.observe(480, { playing: true, rate: 1, now: 400 });
    expect(clock.nowMs(400)).toBe(520);
    expect(clock.nowMs(410)).toBeCloseTo(530, 5);
  });

  test("resume does not adopt a sample that is still behind", () => {
    const clock = new AudioClock();
    clock.set(500, { playing: true, rate: 1, now: 0 });
    clock.observe(480, { playing: false, rate: 1, now: 20 });
    expect(clock.nowMs(20)).toBe(520);

    clock.observe(480, { playing: true, rate: 1, now: 30 });
    // Pointer moved forward from the resume sample, but has not reached 520.
    clock.observe(500, { playing: true, rate: 1, now: 80 });
    expect(clock.nowMs(80)).toBe(520);
    expect(clock.nowMs(90)).toBeCloseTo(530, 5);
  });

  test("lagging media sample does not rewind the interpolator", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });
    // The seek lands and the arrival grace passes.
    clock.observe(1010, { playing: true, rate: 1, now: 20 });
    // Past the grace, the coarse sample is 20ms behind the interpolator.
    clock.observe(1480, { playing: true, rate: 1, now: 500 });
    expect(clock.nowMs(500)).toBeCloseTo(1500, 5);
    expect(clock.nowMs(516)).toBeCloseTo(1516, 5);

    // A sample a little ahead still catches up so the clock stays with the sound.
    clock.observe(1540, { playing: true, rate: 1, now: 520 });
    expect(clock.nowMs(520)).toBe(1540);
    expect(clock.nowMs(528)).toBeCloseTo(1548, 5);
  });

  test("persistent drift slews instead of accumulating to a snap", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });
    // The seek lands and the arrival grace ends.
    clock.observe(1000, { playing: true, rate: 1, now: 10 });
    // Coarse samples consistently ~120ms behind the running interpolator:
    // more than one coarse step, under the 250ms snap threshold. Each
    // sample closes a quarter of the gap instead of waiting to jump.
    clock.observe(1380, { playing: true, rate: 1, now: 500 });
    expect(clock.nowMs(500)).toBe(1470);
    clock.observe(1600, { playing: true, rate: 1, now: 750 });
    expect(clock.nowMs(750)).toBe(1690);
    clock.observe(1820, { playing: true, rate: 1, now: 1000 });
    expect(clock.nowMs(1000)).toBe(1910);
    // A lag within one coarse step is granularity and never rewinds.
    clock.observe(2140, { playing: true, rate: 1, now: 1250 });
    expect(clock.nowMs(1250)).toBeCloseTo(2160, 5);
  });

  test("seek lock ignores stale currentTime for the whole window", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });
    clock.set(5000, { playing: true, rate: 1, now: 10 });
    expect(clock.nowMs(10)).toBe(5000);

    // rAF still samples the pre-seek currentTime.
    clock.observe(1000, { playing: true, rate: 1, now: 20 });
    expect(clock.nowMs(20)).toBeCloseTo(5010, 5);
    expect(clock.nowMs(30)).toBeCloseTo(5020, 5);

    // One sample lands on the target; a late timeupdate still must not rewind.
    clock.observe(5010, { playing: true, rate: 1, now: 40 });
    expect(clock.nowMs(40)).toBeCloseTo(5030, 5);
    clock.observe(1000, { playing: true, rate: 1, now: 50 });
    expect(clock.nowMs(50)).toBeCloseTo(5040, 5);
  });

  test("rebasing onto the current time does not extend the seek lock", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: false, rate: 1, now: 0 });
    clock.set(1000, { playing: false, rate: 1, now: 390 });
    // No sample has arrived near the original set() target yet, so its lock
    // is still inside the ceiling — and the rebase did not restart it.
    clock.observe(0, { playing: false, rate: 1, now: 410 });
    expect(clock.nowMs(410)).toBe(1000);
    // Past the original ceiling (1500), and before 390 + 1500 — which a
    // re-arming rebase would have produced — the far sample is real again.
    clock.observe(0, { playing: false, rate: 1, now: 1600 });
    expect(clock.nowMs(1600)).toBe(0);
  });

  test("a slow seek rejects stale samples until arrival or the ceiling", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });
    clock.set(60000, { playing: true, rate: 1, now: 10 });
    // The element still reports the pre-seek position well past the old
    // 400ms window (long jump, cold cache). No sample has arrived yet.
    clock.observe(1000, { playing: true, rate: 1, now: 500 });
    expect(clock.nowMs(500)).toBeCloseTo(60490, 5);
    clock.observe(1000, { playing: true, rate: 1, now: 1400 });
    expect(clock.nowMs(1400)).toBeCloseTo(61390, 5);
    // Past the ceiling with no arrival, the sample is a real position again.
    clock.observe(1000, { playing: true, rate: 1, now: 1600 });
    expect(clock.nowMs(1600)).toBe(1000);
  });

  test("pause-freeze keeps a lagging paused sample from snapping it back", () => {
    const clock = new AudioClock();
    clock.set(2000, { playing: true, rate: 1, now: 0 });
    // Live-sync style hold: freeze at the interpolated position (the element
    // lags seconds behind it) with the same set() call the embed uses.
    clock.set(2050, { playing: false, rate: 1, now: 50 });
    expect(clock.nowMs(50)).toBe(2050);
    // The element still reports the pre-freeze position — must not snap.
    clock.observe(500, { playing: false, rate: 1, now: 60 });
    expect(clock.nowMs(60)).toBe(2050);
    // After the grace, a far paused sample is a real position change again.
    clock.observe(500, { playing: false, rate: 1, now: 500 });
    expect(clock.nowMs(500)).toBe(500);
  });

  test("pause event freeze holds against a lagging sample", () => {
    const clock = new AudioClock();
    clock.set(1000, { playing: true, rate: 1, now: 0 });
    // The pause event lands while the interpolator runs ahead of the element.
    clock.observe(400, { playing: false, rate: 1, now: 100 });
    expect(clock.nowMs(100)).toBe(1100);
    // The same lagging sample must not pull the frozen position back.
    clock.observe(400, { playing: false, rate: 1, now: 120 });
    expect(clock.nowMs(120)).toBe(1100);
    // Once the grace ends, a large paused jump is still a real seek.
    clock.observe(400, { playing: false, rate: 1, now: 600 });
    expect(clock.nowMs(600)).toBe(400);
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
