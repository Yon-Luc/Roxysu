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

  test("falls back to Sunny on 4K when Daniel is below Alpha", () => {
    expect(
      primaryDanLabel({
        keyCount: 4,
        danielEstDiff: "< Alpha Low",
        sunnyEstDiff: "Reform 5 mid",
      }),
    ).toBe("Reform 5 mid");
  });

  test("falls back to Sunny on 4K when Daniel is above top tier", () => {
    expect(
      primaryDanLabel({
        keyCount: 4,
        danielEstDiff: "> CloverWisp Theta High",
        sunnyEstDiff: "Reform 10 high",
      }),
    ).toBe("Reform 10 high");
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

  test("dan mode uses Sunny on 4K when Daniel is out of band", () => {
    expect(
      formatPrimaryRating({
        mode: "dan",
        starRating: 3,
        keyCount: 4,
        danielEstDiff: "< Alpha Low",
        sunnyEstDiff: "Reform 5 mid",
      }),
    ).toBe("Reform 5 mid");
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

  test("returns Rework dan when source is rework", () => {
    expect(
      primaryRatingDisplayTitle("rework", "rework", {
        reworkDan: "Rework dan",
        reworkStar: "Rework star rating",
      }),
    ).toBe("Rework dan");
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

  test("picks Sunny on 4K in dan mode when Daniel is out of band", () => {
    expect(
      primaryDanSource({
        mode: "dan",
        keyCount: 4,
        danielEstDiff: "< Alpha Low",
        sunnyEstDiff: "Reform 5 mid",
      }),
    ).toBe("sunny");
  });

  test("picks rework when a rework star is present", () => {
    expect(
      primaryDanSource({
        mode: "rework",
        keyCount: 7,
        reworkStar: 4.5,
      }),
    ).toBe("rework");
  });
});

describe("primaryDanStar", () => {
  test("prefers Daniel on 4K", () => {
    expect(
      primaryDanStar({
        keyCount: 4,
        danielStar: 7.1,
        sunnyStar: 5.2,
        reworkStar: 9.9,
      }),
    ).toBe(7.1);
  });

  test("uses rework stars only in rework mode", () => {
    expect(
      primaryDanStar({
        mode: "rework",
        keyCount: 4,
        danielStar: 7.1,
        sunnyStar: 5.2,
        reworkStar: 9.9,
      }),
    ).toBe(9.9);
  });
});
