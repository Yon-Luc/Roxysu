import { describe, expect, test } from "bun:test";
import {
  OnlineQueryError,
  parseOnlineMirrorQuery,
  setMatchesOnlinePostFilters,
} from "./onlineQuery";
import type { OnlineBeatmapSet } from "./search";

function sampleSet(
  overrides: Partial<OnlineBeatmapSet> & {
    beatmaps?: OnlineBeatmapSet["beatmaps"];
  } = {},
): OnlineBeatmapSet {
  return {
    id: 1,
    artist: "a",
    title: "b",
    creator: "c",
    status: "ranked",
    bpm: 180,
    favouriteCount: 0,
    playCount: 0,
    hasVideo: false,
    rankedDate: null,
    beatmaps: [
      {
        id: 10,
        version: "7K",
        stars: 5.5,
        mode: "mania",
        modeInt: 3,
        keys: 7,
      },
      {
        id: 11,
        version: "4K",
        stars: 3.2,
        mode: "mania",
        modeInt: 3,
        keys: 4,
      },
    ],
    ...overrides,
  };
}

describe("parseOnlineMirrorQuery", () => {
  test("maps key=7 status=r to mania + ranked + keys post-filter", () => {
    const q = parseOnlineMirrorQuery("key=7 status=r");
    expect(q.mirrorParams.mode).toBe("mania");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.postFilters).toEqual([
      { field: "keys", op: "=", value: 7, min: undefined, max: undefined },
    ]);
  });

  test("maps stars range to min/max stars + post-filter", () => {
    const q = parseOnlineMirrorQuery("stars:5..6 ranked");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.mirrorParams.minStars).toBe(5);
    expect(q.mirrorParams.maxStars).toBe(6);
    expect(q.postFilters.some((f) => f.field === "stars")).toBe(true);
  });

  test("maps mapper to creator and text to query", () => {
    const q = parseOnlineMirrorQuery("mapper:Lasse title:Zenith");
    expect(q.mirrorParams.creator).toBe("Lasse");
    expect(q.mirrorParams.q).toBe("Zenith");
  });

  test("empty query uses mania + ranked defaults", () => {
    const q = parseOnlineMirrorQuery("");
    expect(q.mirrorParams.mode).toBe("mania");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.postFilters).toEqual([]);
  });

  test("rejects score/practice fields", () => {
    expect(() => parseOnlineMirrorQuery("played:never")).toThrow(OnlineQueryError);
    expect(() => parseOnlineMirrorQuery("pattern:jack")).toThrow(OnlineQueryError);
    expect(() => parseOnlineMirrorQuery("pp>=200")).toThrow(OnlineQueryError);
    expect(() => parseOnlineMirrorQuery("ln<10")).toThrow(OnlineQueryError);
  });

  test("rejects OR and NOT", () => {
    expect(() => parseOnlineMirrorQuery("ranked OR loved")).toThrow(
      OnlineQueryError,
    );
    expect(() => parseOnlineMirrorQuery("NOT ranked")).toThrow(OnlineQueryError);
  });

  test("rejects multi-status lists", () => {
    expect(() => parseOnlineMirrorQuery("status:ranked,loved")).toThrow(
      OnlineQueryError,
    );
  });
});

describe("setMatchesOnlinePostFilters", () => {
  test("matches key=7 when a difficulty has 7 keys", () => {
    const set = sampleSet();
    expect(
      setMatchesOnlinePostFilters(set, [
        { field: "keys", op: "=", value: 7 },
      ]),
    ).toBe(true);
    expect(
      setMatchesOnlinePostFilters(set, [
        { field: "keys", op: "=", value: 5 },
      ]),
    ).toBe(false);
  });

  test("requires one difficulty to satisfy all filters", () => {
    const set = sampleSet();
    // 7K is 5.5★; 4K is 3.2★ — no single diff is key=7 AND stars<4
    expect(
      setMatchesOnlinePostFilters(set, [
        { field: "keys", op: "=", value: 7 },
        { field: "stars", op: "<", value: 4 },
      ]),
    ).toBe(false);
    expect(
      setMatchesOnlinePostFilters(set, [
        { field: "keys", op: "=", value: 7 },
        { field: "stars", op: ">=", value: 5 },
      ]),
    ).toBe(true);
  });
});
