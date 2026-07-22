import { describe, expect, test } from "bun:test";
import {
  buildNerinyanSearchUrl,
  buildOsuDirectSearchUrl,
  extractSearchBeatmapsets,
  normalizeOnlineBeatmapSet,
} from "./search";

describe("normalizeOnlineBeatmapSet", () => {
  test("maps osu-style beatmapset payloads", () => {
    const set = normalizeOnlineBeatmapSet({
      id: 42,
      artist: "xi",
      title: "FREEDOM DiVE",
      creator: "mapper",
      status: "ranked",
      bpm: 222.2,
      favourite_count: 10,
      play_count: 100,
      video: true,
      ranked_date: "2020-01-01T00:00:00Z",
      beatmaps: [
        {
          id: 1,
          version: "Hard",
          difficulty_rating: 4.2,
          mode: "mania",
          mode_int: 3,
          cs: 7,
        },
        {
          id: 2,
          version: "Easy",
          difficulty_rating: 2.1,
          mode: "mania",
          mode_int: 3,
          cs: 4,
        },
      ],
    });

    expect(set).toEqual({
      id: 42,
      artist: "xi",
      title: "FREEDOM DiVE",
      creator: "mapper",
      status: "ranked",
      bpm: 222.2,
      favouriteCount: 10,
      playCount: 100,
      hasVideo: true,
      rankedDate: "2020-01-01T00:00:00Z",
      beatmaps: [
        {
          id: 2,
          version: "Easy",
          stars: 2.1,
          mode: "mania",
          modeInt: 3,
          keys: 4,
        },
        {
          id: 1,
          version: "Hard",
          stars: 4.2,
          mode: "mania",
          modeInt: 3,
          keys: 7,
        },
      ],
    });
  });

  test("rejects invalid payloads", () => {
    expect(normalizeOnlineBeatmapSet(null)).toBeNull();
    expect(normalizeOnlineBeatmapSet({ id: 0 })).toBeNull();
  });
});

describe("extractSearchBeatmapsets", () => {
  test("accepts array or wrapped payloads", () => {
    expect(extractSearchBeatmapsets([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(extractSearchBeatmapsets({ beatmapsets: [{ id: 2 }] })).toEqual([
      { id: 2 },
    ]);
    expect(extractSearchBeatmapsets({ data: [{ id: 3 }] })).toEqual([{ id: 3 }]);
  });
});

describe("search url builders", () => {
  test("builds nerinyan urls", () => {
    expect(
      buildNerinyanSearchUrl({
        q: "stars>5",
        mode: "mania",
        status: "ranked",
        sort: "ranked_desc",
        page: 2,
      }),
    ).toBe(
      "https://api.nerinyan.moe/search?q=stars%3E5&m=3&s=ranked&sort=ranked_desc&page=2",
    );
  });

  test("builds osu.direct urls with 1-based pages", () => {
    expect(
      buildOsuDirectSearchUrl({
        q: "freedom",
        mode: "mania",
        status: "loved",
        page: 0,
      }),
    ).toBe(
      "https://osu.direct/api/v2/search?query=freedom&mode=3&status=loved&page=1",
    );
  });
});
