import { describe, expect, test } from "bun:test";
import {
  formatPrimaryRating,
  primaryDanLabel,
  primaryDanSource,
  primaryDanStar,
  primaryRatingDisplayTitle,
} from "./ratingDisplay";

describe("primaryDanLabel", () => {
  test("prefers Daniel on 4K", () => {
    expect(
      primaryDanLabel({
        keyCount: 4,
        danielEstDiff: "Beta Mid",
        sunnyEstDiff: "Reform 5 mid",
      }),
    ).toBe("Beta Mid");
  });

  test("uses Sunny on 7K", () => {
    expect(
      primaryDanLabel({
        keyCount: 7,
        danielEstDiff: "Beta Mid",
        sunnyEstDiff: "Regular 7 mid",
      }),
    ).toBe("Regular 7 mid");
  });
});

describe("formatPrimaryRating", () => {
  test("dan mode uses Daniel on 4K", () => {
    expect(
      formatPrimaryRating({
        mode: "dan",
        starRating: 3,
        keyCount: 4,
        danielEstDiff: "Alpha Low",
        sunnyEstDiff: "Reform 3 mid",
      }),
    ).toBe("Alpha Low");
  });

  test("sunny mode uses Daniel stars on 4K", () => {
    expect(
      formatPrimaryRating({
        mode: "sunny",
        starRating: 3,
        keyCount: 4,
        danielStar: 6.8,
        sunnyStar: 4.2,
      }),
    ).toBe("6.80★");
  });

  test("sunny mode keeps Sunny stars on 7K", () => {
    expect(
      formatPrimaryRating({
        mode: "sunny",
        starRating: 3,
        keyCount: 7,
        danielStar: 6.8,
        sunnyStar: 4.2,
      }),
    ).toBe("4.20★");
  });
});

describe("primaryRatingDisplayTitle", () => {
  test("returns Daniel dan when source is daniel in dan mode", () => {
    expect(
      primaryRatingDisplayTitle("dan", "daniel", {
        danielDan: "Daniel dan",
        sunnyDan: "Sunny dan",
      }),
    ).toBe("Daniel dan");
  });

  test("returns Sunny dan when source is sunny in dan mode", () => {
    expect(
      primaryRatingDisplayTitle("dan", "sunny", {
        danielDan: "Daniel dan",
        sunnyDan: "Sunny dan",
      }),
    ).toBe("Sunny dan");
  });
});

describe("primaryDanSource", () => {
  test("picks Daniel on 4K in dan mode", () => {
    expect(
      primaryDanSource({
        mode: "dan",
        keyCount: 4,
        danielEstDiff: "Beta Mid",
        sunnyEstDiff: "Reform 5 mid",
      }),
    ).toBe("daniel");
  });
});

describe("primaryDanStar", () => {
  test("prefers Daniel on 4K", () => {
    expect(
      primaryDanStar({
        keyCount: 4,
        danielStar: 7.1,
        sunnyStar: 5.2,
      }),
    ).toBe(7.1);
  });
});
