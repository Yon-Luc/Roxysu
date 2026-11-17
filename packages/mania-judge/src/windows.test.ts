import { describe, expect, test } from "bun:test";
import { judgeError, maniaHitWindows } from "./windows";

describe("maniaHitWindows", () => {
  test("default lazer windows at OD 0, 5, 8, 10", () => {
    expect(maniaHitWindows(0)).toMatchObject({ perfect: 22.5, miss: 188.5 });
    expect(maniaHitWindows(5)).toMatchObject({ perfect: 19.5, miss: 173.5 });
    expect(maniaHitWindows(8)).toMatchObject({
      perfect: 16.5,
      great: 40.5,
      good: 73.5,
      ok: 103.5,
      meh: 127.5,
      miss: 164.5,
    });
    expect(maniaHitWindows(10)).toMatchObject({ perfect: 13.5, miss: 158.5 });
  });

  test("classic non-convert keeps a 16.5 MAX and the 188-3*OD miss", () => {
    expect(maniaHitWindows(0, { classic: true })).toMatchObject({
      perfect: 16.5,
      miss: 188.5,
    });
    expect(maniaHitWindows(8, { classic: true })).toMatchObject({
      perfect: 16.5,
      great: 40.5,
      miss: 164.5,
    });
    expect(maniaHitWindows(10, { classic: true })).toMatchObject({
      perfect: 16.5,
      miss: 158.5,
    });
  });

  test("classic plus ScoreV2 uses the default curve", () => {
    expect(maniaHitWindows(10, { classic: true, scoreV2: true }).perfect).toBe(
      13.5,
    );
  });

  test("classic convert uses the stepped stable windows", () => {
    expect(maniaHitWindows(8, { classic: true, convert: true }).great).toBe(
      34.5,
    );
    expect(maniaHitWindows(4, { classic: true, convert: true }).great).toBe(
      47.5,
    );
  });

  test("rate scales the unfloored width, including rate 1.5", () => {
    expect(maniaHitWindows(8, { rate: 1.5 }).miss).toBe(
      Math.floor(164 * 1.5) + 0.5,
    );
    expect(maniaHitWindows(8, { rate: 1 }).miss).toBe(164.5);
  });

  test("EZ halves OD before the curve", () => {
    expect(maniaHitWindows(8, { easy: true })).toEqual(maniaHitWindows(4));
  });

  test("judge edges match lazer half-windows", () => {
    const od8 = maniaHitWindows(8);
    // Inside Meh, on the Meh edge, then inside the Miss window but past Meh.
    expect(judgeError(120, od8)).toBe("meh");
    expect(judgeError(127.5, od8)).toBe("meh");
    expect(judgeError(160, od8)).toBe("miss");
    expect(judgeError(164.5, od8)).toBe("miss");
    const od10 = maniaHitWindows(10);
    expect(judgeError(15, od10)).toBe("great");
    expect(judgeError(13.5, od10)).toBe("perfect");
  });
});
