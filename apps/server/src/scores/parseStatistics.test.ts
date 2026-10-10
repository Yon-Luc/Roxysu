import { describe, expect, it } from "bun:test";
import { parseScoreStatistics } from "./parseStatistics";

describe("parseScoreStatistics", () => {
  it("returns null for empty input", () => {
    expect(parseScoreStatistics(null)).toBeNull();
    expect(parseScoreStatistics("")).toBeNull();
    expect(parseScoreStatistics("not-json")).toBeNull();
  });

  it("parses mania judgment counts", () => {
    expect(
      parseScoreStatistics(
        JSON.stringify({
          perfect: 100,
          great: 12,
          good: 3,
          meh: 1,
          miss: 2,
        }),
      ),
    ).toEqual({
      perfect: 100,
      great: 12,
      good: 3,
      ok: 0,
      meh: 1,
      miss: 2,
    });
  });

  it("returns zeros when keys exist but all counts are zero", () => {
    expect(parseScoreStatistics(JSON.stringify({ miss: 0 }))).toEqual({
      perfect: 0,
      great: 0,
      good: 0,
      ok: 0,
      meh: 0,
      miss: 0,
    });
  });

  it("ignores unrelated statistics-only objects", () => {
    expect(
      parseScoreStatistics(JSON.stringify({ large_bonus: 4 })),
    ).toBeNull();
  });
});
