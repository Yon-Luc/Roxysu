import { describe, expect, test } from "bun:test";
import { keysFromCs, parseV2Frame, rateFromMods } from "./live";

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

describe("keysFromCs", () => {
  test("reads a bare number", () => {
    expect(keysFromCs(7)).toBe(7);
  });

  test("prefers converted when it is a 1–10 key count", () => {
    expect(keysFromCs({ original: 7, converted: 4 })).toBe(4);
  });

  test("falls back to original when converted is 0 / unused", () => {
    expect(keysFromCs({ original: 7, converted: 0 })).toBe(7);
  });
});

describe("parseV2Frame", () => {
  test("maps beatmap + mods fields", () => {
    const frame = parseV2Frame(
      JSON.stringify({
        state: { number: 7, name: "songSelect" },
        beatmap: {
          checksum: "abc123 ",
          title: "Song",
          version: "7K",
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
    expect(frame.title).toBe("Song");
    expect(frame.version).toBe("7K");
    expect(frame.playing).toBe(false);
  });

  test("marks playing from v2 state 2 / name play", () => {
    const byNumber = parseV2Frame(
      JSON.stringify({
        state: { number: 2, name: "Play" },
        beatmap: { checksum: "x", time: { live: 1 } },
      }),
    );
    const byName = parseV2Frame(
      JSON.stringify({
        state: { name: "play" },
        beatmap: { checksum: "x", time: { live: 1 } },
      }),
    );
    expect(byNumber?.playing).toBe(true);
    expect(byName?.playing).toBe(true);
  });

  test("reads stats.cs object shape from current tosu v2", () => {
    const frame = parseV2Frame(
      JSON.stringify({
        beatmap: {
          checksum: "deadbeef",
          title: "circles!",
          version: "7K",
          mode: { number: 3, name: "mania" },
          stats: { cs: { original: 7, converted: 0 } },
          time: { live: 2197 },
        },
        play: {
          mods: {
            name: "MR",
            array: [{ acronym: "MR" }],
            rate: 1,
          },
        },
      }),
    );
    if (!frame) throw new Error("expected frame");
    expect(frame.keys).toBe(7);
    expect(frame.checksum).toBe("deadbeef");
    expect(frame.title).toBe("circles!");
    expect(frame.version).toBe("7K");
    expect(frame.acronyms).toEqual(["MR"]);
  });

  test("maps legacy menu.bm /json shape", () => {
    const frame = parseV2Frame(
      JSON.stringify({
        menu: {
          gameMode: 3,
          state: 2,
          mods: { str: "MR" },
          bm: {
            md5: "legacy",
            time: { current: 1200 },
            stats: { CS: 4 },
            metadata: { title: "Old", difficulty: "4K" },
          },
        },
      }),
    );
    if (!frame) throw new Error("expected frame");
    expect(frame.checksum).toBe("legacy");
    expect(frame.keys).toBe(4);
    expect(frame.modeNumber).toBe(3);
    expect(frame.acronyms).toEqual(["MR"]);
    expect(frame.timeLiveMs).toBe(1200);
    expect(frame.title).toBe("Old");
    expect(frame.version).toBe("4K");
    expect(frame.playing).toBe(true);
  });

  test("returns null on garbage / error payloads", () => {
    expect(parseV2Frame("not json")).toBeNull();
    expect(parseV2Frame(JSON.stringify({ error: "x" }))).toBeNull();
    expect(parseV2Frame(JSON.stringify({ error: "not_ready" }))).toBeNull();
  });
});
