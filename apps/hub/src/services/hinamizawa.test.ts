import { describe, expect, test } from "bun:test";
import {
  maniaKeysFromBeatmaps,
  parseSearchV2Response,
  setHasManiaKeymode,
} from "./hinamizawa";

describe("parseSearchV2Response", () => {
  test("reads osu-style beatmapsets + pagination metadata", () => {
    const parsed = parseSearchV2Response({
      beatmapsets: [{ id: 2588509 }, { id: 42 }],
      total_count: 7368,
      total_pages: 74,
      limit: 100,
      page: 0,
    });
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]!.SetID).toBe(2588509);
    expect(parsed.results[0]!.maniaKeys).toEqual([]);
    expect(parsed.results[0]!.title).toBe("");
    expect(parsed.results[1]!.SetID).toBe(42);
    expect(parsed.total_count).toBe(7368);
    expect(parsed.total_pages).toBe(74);
  });

  test("extracts mania keymodes and enriched fields from embedded beatmaps", () => {
    const parsed = parseSearchV2Response({
      beatmapsets: [
        {
          id: 1,
          artist: "A",
          title: "Song",
          creator: "Mapper",
          bpm: 180,
          status: "ranked",
          beatmaps: [
            {
              id: 10,
              mode_int: 3,
              cs: 7,
              mode: "mania",
              difficulty_rating: 5.2,
              total_length: 120,
            },
            { mode_int: 3, cs: 4, difficulty_rating: 3.1 },
            { mode_int: 0, cs: 4 },
          ],
        },
        {
          id: 2,
          beatmaps: [{ mode_int: 3, cs: "7.0", difficulty_rating: 4 }],
        },
      ],
      total_count: 2,
      total_pages: 1,
    });
    expect(parsed.results[0]!.maniaKeys).toEqual([4, 7]);
    expect(parsed.results[0]!.artist).toBe("A");
    expect(parsed.results[0]!.title).toBe("Song");
    expect(parsed.results[0]!.creator).toBe("Mapper");
    expect(parsed.results[0]!.bpm).toBe(180);
    expect(parsed.results[0]!.beatmaps.some((d) => d.stars === 5.2)).toBe(true);
    expect(parsed.results[0]!.lengthSeconds).toBe(120);
    expect(parsed.results[1]!.maniaKeys).toEqual([7]);
    expect(setHasManiaKeymode(parsed.results[0]!.maniaKeys, 7)).toBe(true);
    expect(setHasManiaKeymode(parsed.results[0]!.maniaKeys, 5)).toBe(false);
  });

  test("still accepts CheeseGull-style results/SetID if present", () => {
    const parsed = parseSearchV2Response({
      results: [{ SetID: 1 }],
      total_count: 1,
      total_pages: 1,
    });
    expect(parsed.results[0]!.SetID).toBe(1);
    expect(parsed.results[0]!.maniaKeys).toEqual([]);
  });

  test("throws a clear error when beatmapsets is missing", () => {
    expect(() => parseSearchV2Response({ total_count: 0 })).toThrow(
      /missing beatmapsets/,
    );
  });
});

describe("maniaKeysFromBeatmaps", () => {
  test("ignores non-mania diffs", () => {
    expect(
      maniaKeysFromBeatmaps([
        { mode_int: 0, cs: 7 },
        { mode: "mania", cs: 7 },
      ]),
    ).toEqual([7]);
  });
});
