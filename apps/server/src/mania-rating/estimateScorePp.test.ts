import { describe, expect, test } from "bun:test";
import { interpolatePpFromAccuracy } from "./ppAccuracy";
import { resolveScorePp } from "./estimateScorePp";

const curve = {
  "100": 400,
  "99.5": 360,
  "97": 280,
  "95": 220,
  "93": 180,
};

describe("interpolatePpFromAccuracy", () => {
  test("hits exact tiers", () => {
    expect(interpolatePpFromAccuracy(curve, 1)).toBe(400);
    expect(interpolatePpFromAccuracy(curve, 0.95)).toBe(220);
  });

  test("interpolates between tiers", () => {
    // Midway between 95% (220) and 97% (280) at 96%.
    expect(interpolatePpFromAccuracy(curve, 0.96)).toBeCloseTo(250, 5);
  });

  test("accepts percent input", () => {
    expect(interpolatePpFromAccuracy(curve, 100)).toBe(400);
  });

  test("falls back to ppSs when map missing 100", () => {
    expect(interpolatePpFromAccuracy({ "95": 200 }, 1, 412)).toBe(412);
  });
});

describe("resolveScorePp", () => {
  test("prefers stored pp", () => {
    expect(
      resolveScorePp({
        pp: 123,
        accuracy: 0.98,
        mods: "[]",
        rulesetShortName: "mania",
        curve: { ppByAccuracy: curve, ppSs: 400 },
      }),
    ).toBe(123);
  });

  test("estimates NM mania when stored pp is null", () => {
    const pp = resolveScorePp({
      pp: null,
      accuracy: 0.95,
      mods: "[]",
      rulesetShortName: "mania",
      curve: { ppByAccuracy: curve, ppSs: 400 },
    });
    expect(pp).toBe(220);
  });

  test("skips rate mods", () => {
    expect(
      resolveScorePp({
        pp: null,
        accuracy: 0.95,
        mods: JSON.stringify([{ acronym: "DT" }]),
        rulesetShortName: "mania",
        curve: { ppByAccuracy: curve, ppSs: 400 },
      }),
    ).toBeNull();
  });
});
