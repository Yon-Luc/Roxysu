import { describe, expect, test } from "bun:test";
import { parseV2Frame, rateFromMods } from "./live";

describe("rateFromMods", () => {
  test("custom DT speed_change wins", () => {
    expect(
      rateFromMods({
        rate: 1.5,
        array: [{ acronym: "DT", settings: { speed_change: 1.25 } }],
      }),
    ).toBe(1.25);
  });

  test("falls back to tosu aggregated rate", () => {
    expect(rateFromMods({ rate: 1.4, array: ["DT"] })).toBe(1.4);
  });

  test("defaults to 1", () => {
    expect(rateFromMods({ array: ["HD"] })).toBe(1);
    expect(rateFromMods(null)).toBe(1);
  });
});

describe("parseV2Frame", () => {
  test("maps beatmap + mods fields", () => {
    const frame = parseV2Frame(
      JSON.stringify({
        state: { number: 7, name: "songSelect" },
        beatmap: {
          checksum: "abc123 ",
          mode: { number: 3, name: "osumania" },
          stats: { cs: 7 },
          time: { live: 42_500 },
        },
        play: {
          mods: {
            name: "MR",
            array: [{ acronym: "MR" }, { acronym: "DT", settings: { speed_change: 1.1 } }],
            rate: 1.5,
          },
        },
      }),
    );
    if (!frame) throw new Error("expected frame");
    expect(frame.checksum).toBe("abc123");
    expect(frame.modeNumber).toBe(3);
    expect(frame.keys).toBe(7);
    expect(frame.acronyms).toEqual(["MR", "DT"]);
    expect(frame.rate).toBe(1.1);
    expect(frame.timeLiveMs).toBe(42_500);
  });

  test("returns null on garbage / error payloads", () => {
    expect(parseV2Frame("not json")).toBeNull();
    expect(parseV2Frame(JSON.stringify({ error: "x" }))).toBeNull();
  });
});
