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
    expect(parsed).toEqual({
      results: [
        { SetID: 2588509, maniaKeys: [] },
        { SetID: 42, maniaKeys: [] },
      ],
      total_count: 7368,
      total_pages: 74,
    });
  });

  test("extracts mania keymodes from embedded beatmaps cs", () => {
    const parsed = parseSearchV2Response({
      beatmapsets: [
        {
          id: 1,
          beatmaps: [
            { mode_int: 3, cs: 7, mode: "mania" },
            { mode_int: 3, cs: 4 },
            { mode_int: 0, cs: 4 },
          ],
        },
        {
          id: 2,
          beatmaps: [{ mode_int: 3, cs: "7.0" }],
        },
      ],
      total_count: 2,
      total_pages: 1,
    });
    expect(parsed.results[0]).toEqual({ SetID: 1, maniaKeys: [4, 7] });
    expect(parsed.results[1]).toEqual({ SetID: 2, maniaKeys: [7] });
    expect(setHasManiaKeymode(parsed.results[0]!.maniaKeys, 7)).toBe(true);
    expect(setHasManiaKeymode(parsed.results[0]!.maniaKeys, 5)).toBe(false);
  });

  test("still accepts CheeseGull-style results/SetID if present", () => {
    const parsed = parseSearchV2Response({
      results: [{ SetID: 1 }],
      total_count: 1,
      total_pages: 1,
    });
    expect(parsed.results).toEqual([{ SetID: 1, maniaKeys: [] }]);
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
