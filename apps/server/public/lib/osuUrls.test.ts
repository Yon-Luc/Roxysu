import { describe, expect, test } from "bun:test";
import { osuWebScoreUrl } from "./osuUrls";

describe("osuWebScoreUrl", () => {
  test("builds the osu! score page for a submitted id", () => {
    expect(osuWebScoreUrl(123456)).toBe("https://osu.ppy.sh/scores/123456");
  });

  test("hides the link when the score was not submitted", () => {
    expect(osuWebScoreUrl(-1)).toBeNull();
    expect(osuWebScoreUrl(0)).toBeNull();
    expect(osuWebScoreUrl(null)).toBeNull();
    expect(osuWebScoreUrl(undefined)).toBeNull();
  });
});
