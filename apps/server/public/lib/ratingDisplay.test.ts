import { describe, expect, test } from "bun:test";
import {
  formatPrimaryRating,
  primaryDanLabel,
  primaryDanSource,
  primaryDanStar,
  primaryRatingDisplayTitle,
} from "./ratingDisplay";

describe("primaryDanLabel", () => {
  test("returns the rework label when present", () => {
    expect(primaryDanLabel({ reworkEstDiff: "α mid" })).toBe("α mid");
  });

  test("returns null when missing", () => {
    expect(primaryDanLabel({})).toBeNull();
  });
});

describe("formatPrimaryRating", () => {
  test("osu mode uses osu stars", () => {
    expect(
      formatPrimaryRating({
        mode: "osu",
        starRating: 3.5,
        reworkEstDiff: "α mid",
        reworkStar: 6.8,
      }),
    ).toBe("3.50★");
  });

  test("rework mode uses the stored rework dan label", () => {
    expect(
      formatPrimaryRating({
        mode: "rework",
        starRating: 3,
        reworkEstDiff: "Keep Me",
      }),
    ).toBe("Keep Me");
  });

  test("rework mode falls back to rework stars, not osu stars", () => {
    expect(
      formatPrimaryRating({
        mode: "rework",
        starRating: 3,
        reworkStar: 5.25,
      }),
    ).toBe("5.25★");
  });
});

describe("primaryRatingDisplayTitle", () => {
  test("returns Rework dan when source is rework", () => {
    expect(
      primaryRatingDisplayTitle("rework", "rework", {
        reworkDan: "Rework dan",
        reworkStar: "Rework star rating",
      }),
    ).toBe("Rework dan");
  });

  test("returns null for osu mode", () => {
    expect(primaryRatingDisplayTitle("osu", null)).toBeNull();
  });
});

describe("primaryDanSource", () => {
  test("picks rework when a rework star is present", () => {
    expect(
      primaryDanSource({
        mode: "rework",
        reworkStar: 4.5,
      }),
    ).toBe("rework");
  });

  test("returns null in osu mode", () => {
    expect(
      primaryDanSource({
        mode: "osu",
        reworkEstDiff: "α mid",
      }),
    ).toBeNull();
  });
});

describe("primaryDanStar", () => {
  test("returns rework stars", () => {
    expect(primaryDanStar({ reworkStar: 9.9 })).toBe(9.9);
  });
});
