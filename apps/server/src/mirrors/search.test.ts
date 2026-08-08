import { describe, expect, test } from "bun:test";
import {
  buildHinaiCountSearchUrl,
  buildHinaiSearchUrl,
  buildNerinyanSearchUrl,
  buildOsuDirectSearchUrl,
  extractSearchBeatmapsets,
  extractTotalCount,
  normalizeCheeseGullBeatmapSet,
  normalizeMirrorSearchResult,
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

describe("normalizeCheeseGullBeatmapSet", () => {
  test("maps hinai's CheeseGull-shaped payloads", () => {
    const set = normalizeCheeseGullBeatmapSet({
      SetID: 292301,
      Artist: "xi",
      Title: "Blue Zenith",
      Creator: "Asphyxia",
      RankedStatus: 1,
      HasVideo: 0,
      Favourites: 5000,
      PlayCount: 900000,
      ApprovedDate: "2015-08-09 19:39:24",
      ChildrenBeatmaps: [
        {
          BeatmapID: 658127,
          DiffName: "FOUR DIMENSIONS",
          DifficultyRating: 7.51,
          Mode: 0,
          CS: 4,
        },
      ],
    });

    expect(set).toEqual({
      id: 292301,
      artist: "xi",
      title: "Blue Zenith",
      creator: "Asphyxia",
      status: "ranked",
      bpm: null,
      favouriteCount: 5000,
      playCount: 900000,
      hasVideo: false,
      rankedDate: "2015-08-09 19:39:24",
      beatmaps: [
        {
          id: 658127,
          version: "FOUR DIMENSIONS",
          stars: 7.51,
          mode: "osu",
          modeInt: 0,
          keys: null,
        },
      ],
    });
  });

  test("rejects invalid payloads", () => {
    expect(normalizeCheeseGullBeatmapSet(null)).toBeNull();
    expect(normalizeCheeseGullBeatmapSet({ SetID: 0 })).toBeNull();
  });
});

describe("normalizeMirrorSearchResult", () => {
  test("routes to the CheeseGull normalizer for hinai", () => {
    const set = normalizeMirrorSearchResult("hinai", {
      SetID: 1,
      Artist: "a",
      Title: "b",
      Creator: "c",
      RankedStatus: 4,
      ChildrenBeatmaps: [],
    });
    expect(set?.status).toBe("loved");
  });

  test("routes hinai v2-shaped rows to the osu-style normalizer", () => {
    const set = normalizeMirrorSearchResult("hinai", {
      id: 9,
      artist: "a",
      title: "b",
      creator: "c",
      status: "graveyard",
      beatmaps: [],
    });
    expect(set?.id).toBe(9);
    expect(set?.status).toBe("graveyard");
  });

  test("routes to the osu-style normalizer for nerinyan/osu.direct", () => {
    const set = normalizeMirrorSearchResult("nerinyan", {
      id: 1,
      artist: "a",
      title: "b",
      creator: "c",
      status: "ranked",
      beatmaps: [],
    });
    expect(set?.status).toBe("ranked");
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

  test("builds hinai urls with numeric status + offset paging", () => {
    expect(
      buildHinaiSearchUrl({
        q: "freedom",
        mode: "mania",
        status: "loved",
        page: 2,
      }),
    ).toBe(
      "https://mirror.hinamizawa.ai/api/v1/hinai/search?query=freedom&mode=3&status=4&amount=100&offset=200",
    );
  });

  test("hinai urls include star bounds and creator", () => {
    const url = buildHinaiSearchUrl({
      mode: "mania",
      status: "ranked",
      minStars: 5,
      maxStars: 7,
      creator: "Lasse",
      page: 0,
    });
    expect(url).toContain("min_stars=5");
    expect(url).toContain("max_stars=7");
    expect(url).toContain("creator=Lasse");
  });

  test("hinai graveyard uses v2 search endpoint", () => {
    const url = buildHinaiSearchUrl({ status: "graveyard", mode: "mania" });
    expect(url).toContain("/v3/osu/beatmaps/search/v2");
    expect(url).toContain("status=graveyard");
    expect(url).toContain("mode=3");
  });

  test("hinai count probes always use v2 for total_count", () => {
    const url = buildHinaiCountSearchUrl({
      mode: "osu",
      status: "ranked",
      page: 5,
    });
    expect(url).toContain("/v3/osu/beatmaps/search/v2");
    expect(url).toContain("status=ranked");
    expect(url).toContain("mode=0");
    expect(url).toContain("page=0");
    expect(url).not.toContain("/api/v1/hinai/search");
  });
});

describe("extractTotalCount", () => {
  test("reads total_count from hinai v2 wrapper", () => {
    expect(extractTotalCount({ beatmapsets: [], total_count: 42100 })).toBe(
      42100,
    );
  });

  test("returns null for v1 flat arrays", () => {
    expect(extractTotalCount([{ SetID: 1 }])).toBeNull();
  });
});
