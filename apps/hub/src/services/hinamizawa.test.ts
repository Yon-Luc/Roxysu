import { describe, expect, test } from "bun:test";
import { parseSearchV2Response } from "./hinamizawa";

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
      results: [{ SetID: 2588509 }, { SetID: 42 }],
      total_count: 7368,
      total_pages: 74,
    });
  });

  test("still accepts CheeseGull-style results/SetID if present", () => {
    const parsed = parseSearchV2Response({
      results: [{ SetID: 1 }],
      total_count: 1,
      total_pages: 1,
    });
    expect(parsed.results).toEqual([{ SetID: 1 }]);
  });

  test("throws a clear error when beatmapsets is missing", () => {
    expect(() => parseSearchV2Response({ total_count: 0 })).toThrow(
      /missing beatmapsets/,
    );
  });
});
