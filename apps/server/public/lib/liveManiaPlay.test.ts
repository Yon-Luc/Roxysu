import { describe, expect, test } from "bun:test";
import { LiveManiaPlay } from "./liveManiaPlay";
import { judgeError, maniaHitWindows } from "./maniaWindows";

describe("maniaHitWindows", () => {
  test("matches server OD8 windows", () => {
    const w = maniaHitWindows(8);
    expect(w.perfect).toBe(16);
    expect(w.great).toBe(40);
    expect(w.good).toBe(73);
    expect(w.ok).toBe(103);
    expect(w.meh).toBe(127);
    expect(w.miss).toBe(154);
  });

  test("judgeError picks tightest window", () => {
    const w = maniaHitWindows(8);
    expect(judgeError(0, w)).toBe("perfect");
    expect(judgeError(16, w)).toBe("perfect");
    expect(judgeError(17, w)).toBe("great");
    expect(judgeError(40, w)).toBe("great");
    expect(judgeError(41, w)).toBe("good");
    expect(judgeError(200, w)).toBe("miss");
  });
});

describe("LiveManiaPlay", () => {
  test("perfect press on a tap", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 0, startMs: 1000, endMs: 1000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    const j = play.press(0, 1000);
    expect(j?.result).toBe("perfect");
    expect(j?.errorMs).toBe(0);
    expect(play.summary.counts.perfect).toBe(1);
    expect(play.combo).toBe(1);
  });

  test("auto-miss when past miss window", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 0, startMs: 1000, endMs: 1000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    const missAt = 1000 + maniaHitWindows(8).miss + 1;
    play.tick(missAt);
    expect(play.judgments).toHaveLength(1);
    expect(play.judgments[0]!.result).toBe("miss");
    expect(play.judgments[0]!.errorMs).toBeNull();
    expect(play.combo).toBe(0);
  });

  test("press outside window does not hit next note early", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 0, startMs: 2000, endMs: 2000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    const j = play.press(0, 1000);
    expect(j).toBeNull();
    expect(play.judgments).toHaveLength(0);
  });

  test("LN early release beyond miss window is miss", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 1, startMs: 1000, endMs: 2000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    expect(play.press(1, 1000)?.result).toBe("perfect");
    const tail = play.release(1, 1200);
    expect(tail?.isTail).toBe(true);
    expect(tail?.result).toBe("miss");
  });

  test("LN release near end judges by timing window", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 1, startMs: 1000, endMs: 2000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    expect(play.press(1, 1000)?.result).toBe("perfect");
    const tail = play.release(1, 2000 - 100);
    expect(tail?.isTail).toBe(true);
    expect(tail?.result).toBe("ok");
  });

  test("practiceRange only judges notes in window", () => {
    const play = new LiveManiaPlay({
      notes: [
        { column: 0, startMs: 500, endMs: 500 },
        { column: 0, startMs: 1500, endMs: 1500 },
        { column: 0, startMs: 2500, endMs: 2500 },
      ],
      columnCount: 4,
      overallDifficulty: 8,
      practiceRange: { fromMs: 1000, toMs: 2000 },
    });
    play.tick(3000);
    expect(play.judgments).toHaveLength(1);
    expect(play.judgments[0]!.noteIndex).toBe(1);
    expect(play.judgments[0]!.result).toBe("miss");
  });

  test("reset clears state", () => {
    const play = new LiveManiaPlay({
      notes: [{ column: 0, startMs: 1000, endMs: 1000 }],
      columnCount: 4,
      overallDifficulty: 8,
    });
    play.press(0, 1000);
    play.reset();
    expect(play.judgments).toHaveLength(0);
    expect(play.combo).toBe(0);
    expect(play.heldMask).toBe(0);
    expect(play.press(0, 1000)?.result).toBe("perfect");
  });
});
