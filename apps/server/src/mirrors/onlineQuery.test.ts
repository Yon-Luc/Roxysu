import { describe, expect, test } from "bun:test";
import {
  OnlineQueryError,
  exactKeymodeFromPostFilters,
  hubCacheKeymode,
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
    lengthSeconds: 120,
    beatmaps: [
      {
        id: 10,
        version: "7K",
        stars: 5.5,
        mode: "mania",
        modeInt: 3,
        keys: 7,
        totalLength: 120,
      },
      {
        id: 11,
        version: "4K",
        stars: 3.2,
        mode: "mania",
        modeInt: 3,
        keys: 4,
        totalLength: 120,
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

  test("maps mode=m status=r to mania + ranked without free-text q", () => {
    const q = parseOnlineMirrorQuery("mode=m status=r");
    expect(q.mirrorParams.mode).toBe("mania");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.mirrorParams.q).toBeUndefined();
    expect(q.postFilters).toEqual([]);
  });

  test("maps mode=mania status=r to mania + ranked without free-text q", () => {
    const q = parseOnlineMirrorQuery("mode=mania status=r");
    expect(q.mirrorParams.mode).toBe("mania");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.mirrorParams.q).toBeUndefined();
    expect(q.postFilters).toEqual([]);
  });

  test("maps mode:m status:r to mania + ranked", () => {
    const q = parseOnlineMirrorQuery("mode:m status:r");
    expect(q.mirrorParams.mode).toBe("mania");
    expect(q.mirrorParams.status).toBe("ranked");
    expect(q.mirrorParams.q).toBeUndefined();
    expect(q.postFilters).toEqual([]);
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

describe("exactKeymodeFromPostFilters", () => {
  test("returns key for single equality filter from key=7", () => {
    const q = parseOnlineMirrorQuery("key=7 status=r");
    expect(exactKeymodeFromPostFilters(q.postFilters)).toBe(7);
  });

  test("returns null when stars also present", () => {
    const q = parseOnlineMirrorQuery("key=7 stars>=5 status=r");
    expect(exactKeymodeFromPostFilters(q.postFilters)).toBeNull();
  });

  test("returns null for empty post-filters", () => {
    expect(exactKeymodeFromPostFilters([])).toBeNull();
  });
});

describe("hubCacheKeymode", () => {
  test("empty post-filters are eligible without key", () => {
    expect(hubCacheKeymode([])).toEqual({ keymode: null });
  });

  test("exact key alone is eligible", () => {
    const q = parseOnlineMirrorQuery("key=7 status=r");
    expect(hubCacheKeymode(q.postFilters)).toEqual({ keymode: 7 });
  });

  test("key plus stars is eligible (stars are Hub secondary filters)", () => {
    const q = parseOnlineMirrorQuery("key=7 stars:5..6 status=r");
    expect(hubCacheKeymode(q.postFilters)).toEqual({ keymode: 7 });
  });

  test("stars alone are eligible without key", () => {
    const q = parseOnlineMirrorQuery("stars>=5 status=r");
    expect(hubCacheKeymode(q.postFilters)).toEqual({ keymode: null });
  });

  test("key range is not eligible", () => {
    const q = parseOnlineMirrorQuery("key>=4 key<=7 status=r");
    expect(hubCacheKeymode(q.postFilters)).toBeNull();
  });

  test("non-star non-exact-key filters are not eligible", () => {
    expect(
      hubCacheKeymode([
        { field: "keys", op: "=", value: 7 },
        { field: "keys", op: "=", value: 4 },
      ]),
    ).toBeNull();
  });
});
