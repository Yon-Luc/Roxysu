import { describe, expect, test } from "bun:test";
import {
  formatModAcronym,
  isNomodOrMirrorOnly,
  parseScoreMods,
  scaleManiaHitWindows,
} from "./mods";
import { maniaHitWindows } from "./judge";

describe("parseScoreMods", () => {
  test("defaults DT to 1.5x", () => {
    expect(parseScoreMods('[{"acronym":"DT"}]').rate).toBe(1.5);
  });

  test("reads custom DT speed_change", () => {
    const mods = parseScoreMods(
      '[{"acronym":"DT","settings":{"speed_change":1.15}}]',
    );
    expect(mods.rate).toBe(1.15);
    expect(mods.acronyms).toEqual(["DT"]);
  });

  test("reads custom HT speed_change", () => {
    const mods = parseScoreMods(
      '[{"acronym":"HT","settings":{"speed_change":0.85}}]',
    );
    expect(mods.rate).toBe(0.85);
  });

  test("treats NC like DT", () => {
    expect(
      parseScoreMods('[{"acronym":"NC","settings":{"speed_change":1.05}}]')
        .rate,
    ).toBe(1.05);
  });

  test("no rate mod stays at 1", () => {
    expect(parseScoreMods('[{"acronym":"HD"}]').rate).toBe(1);
    expect(parseScoreMods("[]").rate).toBe(1);
  });

  test("legacy string mod list", () => {
    expect(parseScoreMods('["DT","HD"]').rate).toBe(1.5);
  });
});

describe("isNomodOrMirrorOnly", () => {
  test("allows empty / null mods", () => {
    expect(isNomodOrMirrorOnly(null)).toBe(true);
    expect(isNomodOrMirrorOnly(undefined)).toBe(true);
    expect(isNomodOrMirrorOnly("[]")).toBe(true);
    expect(isNomodOrMirrorOnly("{}")).toBe(true);
  });

  test("allows Mirror only", () => {
    expect(isNomodOrMirrorOnly('[{"acronym":"MR"}]')).toBe(true);
    expect(isNomodOrMirrorOnly('["MR"]')).toBe(true);
  });

  test("rejects rate and other gameplay mods", () => {
    expect(isNomodOrMirrorOnly('[{"acronym":"DT"}]')).toBe(false);
    expect(isNomodOrMirrorOnly('[{"acronym":"HT"}]')).toBe(false);
    expect(isNomodOrMirrorOnly('[{"acronym":"HD"}]')).toBe(false);
    expect(isNomodOrMirrorOnly('[{"acronym":"MR"},{"acronym":"DT"}]')).toBe(
      false,
    );
  });
});

describe("scaleManiaHitWindows", () => {
  test("scales windows with playback rate", () => {
    const base = maniaHitWindows(8);
    const scaled = scaleManiaHitWindows(base, 1.15);
    expect(scaled.great).toBe(Math.floor(base.great * 1.15) + 0.5);
    expect(scaled.miss).toBe(Math.floor(base.miss * 1.15) + 0.5);
  });

  test("rate 1 is a no-op", () => {
    const base = maniaHitWindows(8);
    expect(scaleManiaHitWindows(base, 1)).toEqual(base);
  });
});

describe("formatModAcronym", () => {
  test("shows custom speed as X label", () => {
    expect(
      formatModAcronym({
        acronym: "DT",
        settings: { speed_change: 1.15 },
      }),
    ).toBe("X1.15");
  });

  test("shows default mod acronym", () => {
    expect(formatModAcronym({ acronym: "DT" })).toBe("DT");
    expect(
      formatModAcronym({
        acronym: "DT",
        settings: { speed_change: 1.5 },
      }),
    ).toBe("DT");
  });
});
