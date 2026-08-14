import { describe, expect, test } from "bun:test";
import { uniqueBeatmapsetIds, uniqueTags } from "./collectionWrite";

describe("uniqueTags", () => {
  test("dedupes and trims, keeping first order", () => {
    expect(uniqueTags([" mania", "7k", "mania", "7k ", ""])).toEqual([
      "mania",
      "7k",
    ]);
  });
});

describe("uniqueBeatmapsetIds", () => {
  test("drops non-positive and duplicate ids", () => {
    expect(
      uniqueBeatmapsetIds([1, 0, 1, 2, -3], ["a", "skip", "dup", "b", "neg"]),
    ).toEqual({
      beatmapsetIds: [1, 2],
      mapNames: ["a", "b"],
    });
  });
});
