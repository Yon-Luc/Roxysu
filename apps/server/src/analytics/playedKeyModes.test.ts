import { describe, expect, test } from "bun:test";
import { playedKeyModesFromRows } from "./playerStats";

describe("playedKeyModesFromRows", () => {
  test("prefers the key count with the most plays and still offers 4 and 7", () => {
    expect(
      playedKeyModesFromRows([
        { keyCount: 4, plays: 20 },
        { keyCount: 8, plays: 3 },
      ]),
    ).toEqual({
      keyCounts: [4, 7, 8],
      preferredKeyCount: 4,
    });
  });

  test("defaults to 7K when there are no mania plays", () => {
    expect(playedKeyModesFromRows([])).toEqual({
      keyCounts: [4, 7],
      preferredKeyCount: 7,
    });
  });
});
