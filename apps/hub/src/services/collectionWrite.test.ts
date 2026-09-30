import { describe, expect, test } from "bun:test";
import {
  uniqueBeatmaps,
  uniqueBeatmapsetIds,
  uniqueTags,
} from "./collectionWrite";

describe("uniqueTags", () => {
  test("dedupes and trims, keeping first order", () => {
    expect(uniqueTags([" mania", "7k", "mania", "7k ", ""])).toEqual([
      "mania",
      "7k",
    ]);
  });
});

describe("uniqueBeatmaps", () => {
  test("keeps one row per difficulty and the sets those difficulties belong to", () => {
    expect(
      uniqueBeatmaps([
        { beatmapsetId: 10, beatmapId: 100 },
        { beatmapsetId: 10, beatmapId: 101 },
        { beatmapsetId: 10, beatmapId: 100 },
        { beatmapsetId: 0, beatmapId: 102 },
        { beatmapsetId: 11, beatmapId: -1 },
        { beatmapsetId: 12, beatmapId: 200 },
      ]),
    ).toEqual({
      beatmapsetIds: [10, 12],
      beatmaps: [
        { beatmapsetId: 10, beatmapId: 100 },
        { beatmapsetId: 10, beatmapId: 101 },
        { beatmapsetId: 12, beatmapId: 200 },
      ],
    });
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
