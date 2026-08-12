import { describe, expect, test } from "bun:test";
import type { OnlineBeatmapSet } from "../../lib/api";
import {
  DEFAULT_MAP_FILTERS,
  filterAndSortCollectionMaps,
  hasAdvancedMapFilters,
  matchesNameQuery,
  setMaxStars,
  type FilterableMapRow,
} from "./hubCollectionMapFilters";

function makeSet(
  overrides: Partial<OnlineBeatmapSet> & {
    beatmaps?: OnlineBeatmapSet["beatmaps"];
  },
): OnlineBeatmapSet {
  return {
    id: 1,
    artist: "Artist",
    title: "Title",
    creator: "Mapper",
    status: "ranked",
    bpm: 180,
    favouriteCount: 0,
    playCount: 0,
    hasVideo: false,
    rankedDate: "2024-01-01T00:00:00Z",
    lengthSeconds: 120,
    beatmaps: [
      {
        id: 10,
        version: "Hard",
        stars: 4.5,
        mode: "mania",
        modeInt: 3,
        keys: 7,
        totalLength: 120,
      },
    ],
    ...overrides,
  };
}

function row(
  partial: Partial<FilterableMapRow> & { setId: number },
): FilterableMapRow {
  return {
    mapName: "",
    set: undefined,
    owned: false,
    collectionIndex: partial.setId,
    ...partial,
  };
}

describe("hubCollectionMapFilters", () => {
  test("setMaxStars returns highest difficulty", () => {
    const set = makeSet({
      beatmaps: [
        {
          id: 1,
          version: "Easy",
          stars: 2,
          mode: "osu",
          modeInt: 0,
          keys: null,
          totalLength: 100,
        },
        {
          id: 2,
          version: "Expert",
          stars: 6.2,
          mode: "osu",
          modeInt: 0,
          keys: null,
          totalLength: 100,
        },
      ],
    });
    expect(setMaxStars(set)).toBe(6.2);
  });

  test("matchesNameQuery searches title artist creator mapName and id", () => {
    const set = makeSet({ title: "Freedom Dive", artist: "xi", creator: "Nakagawa" });
    expect(matchesNameQuery(set, "hub name", 42, "freedom")).toBe(true);
    expect(matchesNameQuery(set, "hub name", 42, "xi")).toBe(true);
    expect(matchesNameQuery(set, "hub name", 42, "nakagawa")).toBe(true);
    expect(matchesNameQuery(undefined, "Cool Map", 99, "cool")).toBe(true);
    expect(matchesNameQuery(undefined, "", 12345, "12345")).toBe(true);
    expect(matchesNameQuery(set, "", 1, "zzz")).toBe(false);
  });

  test("defaults show all ownership and sort by highest stars", () => {
    const rows = [
      row({
        setId: 1,
        owned: true,
        collectionIndex: 0,
        set: makeSet({ id: 1, title: "Owned Soft", beatmaps: [
          { id: 1, version: "x", stars: 8, mode: "mania", modeInt: 3, keys: 4, totalLength: 1 },
        ] }),
      }),
      row({
        setId: 2,
        owned: false,
        collectionIndex: 1,
        set: makeSet({ id: 2, title: "Missing Hard", beatmaps: [
          { id: 2, version: "x", stars: 5, mode: "mania", modeInt: 3, keys: 4, totalLength: 1 },
        ] }),
      }),
      row({
        setId: 3,
        owned: false,
        collectionIndex: 2,
        set: makeSet({ id: 3, title: "Missing Harder", beatmaps: [
          { id: 3, version: "x", stars: 7, mode: "mania", modeInt: 3, keys: 4, totalLength: 1 },
        ] }),
      }),
    ];

    const out = filterAndSortCollectionMaps(rows, DEFAULT_MAP_FILTERS);
    expect(out.map((r) => r.setId)).toEqual([1, 3, 2]);
  });

  test("missing ownership filter hides owned maps", () => {
    const rows = [
      row({
        setId: 1,
        owned: true,
        set: makeSet({ id: 1, beatmaps: [
          { id: 1, version: "x", stars: 8, mode: "mania", modeInt: 3, keys: 4, totalLength: 1 },
        ] }),
      }),
      row({
        setId: 2,
        owned: false,
        set: makeSet({ id: 2, beatmaps: [
          { id: 2, version: "x", stars: 5, mode: "mania", modeInt: 3, keys: 4, totalLength: 1 },
        ] }),
      }),
    ];

    const out = filterAndSortCollectionMaps(rows, {
      ...DEFAULT_MAP_FILTERS,
      ownership: "missing",
      sort: "collection",
    });
    expect(out.map((r) => r.setId)).toEqual([2]);
  });

  test("hasAdvancedMapFilters is false for defaults", () => {
    expect(hasAdvancedMapFilters(DEFAULT_MAP_FILTERS)).toBe(false);
    expect(
      hasAdvancedMapFilters({ ...DEFAULT_MAP_FILTERS, ownership: "missing" }),
    ).toBe(true);
  });

  test("mode and keys filters exclude placeholders", () => {
    const rows = [
      row({ setId: 1, mapName: "stub", set: undefined }),
      row({
        setId: 2,
        set: makeSet({
          id: 2,
          beatmaps: [
            {
              id: 20,
              version: "4k",
              stars: 3,
              mode: "mania",
              modeInt: 3,
              keys: 4,
              totalLength: 1,
            },
          ],
        }),
      }),
      row({
        setId: 3,
        set: makeSet({
          id: 3,
          beatmaps: [
            {
              id: 30,
              version: "7k",
              stars: 4,
              mode: "mania",
              modeInt: 3,
              keys: 7,
              totalLength: 1,
            },
          ],
        }),
      }),
    ];

    const out = filterAndSortCollectionMaps(rows, {
      ...DEFAULT_MAP_FILTERS,
      ownership: "all",
      mode: "mania",
      keys: 7,
      sort: "collection",
    });
    expect(out.map((r) => r.setId)).toEqual([3]);
  });

  test("star bounds filter on max stars", () => {
    const rows = [
      row({
        setId: 1,
        set: makeSet({
          id: 1,
          beatmaps: [
            {
              id: 1,
              version: "a",
              stars: 3,
              mode: "osu",
              modeInt: 0,
              keys: null,
              totalLength: 1,
            },
          ],
        }),
      }),
      row({
        setId: 2,
        set: makeSet({
          id: 2,
          beatmaps: [
            {
              id: 2,
              version: "b",
              stars: 6,
              mode: "osu",
              modeInt: 0,
              keys: null,
              totalLength: 1,
            },
          ],
        }),
      }),
    ];

    const out = filterAndSortCollectionMaps(rows, {
      ...DEFAULT_MAP_FILTERS,
      ownership: "all",
      minStars: "5",
      maxStars: "7",
      sort: "collection",
    });
    expect(out.map((r) => r.setId)).toEqual([2]);
  });
});
