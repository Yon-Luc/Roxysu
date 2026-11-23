import { describe, expect, test } from "bun:test";
import type { PlayerStats } from "../../lib/api";
import { historyBandValue, skillEvolutionDomain } from "./statsHelpers";

type Point = NonNullable<PlayerStats["skillHistory"]>[number];

function point(overrides: Partial<Point> = {}): Point {
  return {
    at: "2026-01-01",
    push: 0,
    accuracy: 0,
    consistency: 0,
    pushRc: 0,
    pushLn: 0,
    pushFln: 0,
    accuracyRc: 0,
    accuracyLn: 0,
    accuracyFln: 0,
    consistencyRc: 0,
    consistencyLn: 0,
    consistencyFln: 0,
    overall: 0,
    rc: 0,
    ln: 0,
    fln: 0,
    coldStart: false,
    ...overrides,
  } as Point;
}

describe("historyBandValue", () => {
  test("all returns the overall band, or a gap when it is zero", () => {
    expect(historyBandValue(point({ push: 8 }), "push", "all")).toBe(8);
    expect(historyBandValue(point({ push: 0 }), "push", "all")).toBeNull();
  });

  test("a zero axis is a gap, not a copy of overall", () => {
    const row = point({ push: 8, pushLn: 0, accuracy: 7, accuracyRc: 0 });
    expect(historyBandValue(row, "push", "ln")).toBeNull();
    expect(historyBandValue(row, "accuracy", "rc")).toBeNull();
  });

  test("a positive axis value is kept even when it differs from overall", () => {
    const row = point({
      push: 8,
      pushRc: 5,
      pushLn: 6,
      pushFln: 4,
      accuracy: 9,
      accuracyFln: 3,
      consistency: 7,
      consistencyLn: 2,
    });
    expect(historyBandValue(row, "push", "rc")).toBe(5);
    expect(historyBandValue(row, "push", "ln")).toBe(6);
    expect(historyBandValue(row, "push", "fln")).toBe(4);
    expect(historyBandValue(row, "accuracy", "fln")).toBe(3);
    expect(historyBandValue(row, "consistency", "ln")).toBe(2);
  });
});

describe("skillEvolutionDomain", () => {
  test("the floor is the lowest band, not zero", () => {
    expect(
      skillEvolutionDomain(
        [
          { push: 4, accuracy: 1, consistency: 3 },
          { push: 6, accuracy: 2, consistency: 5 },
        ],
        null,
      ),
    ).toEqual([1, 6]);
  });

  test("null gaps are skipped", () => {
    expect(
      skillEvolutionDomain(
        [
          { push: null, accuracy: 2, consistency: 5 },
          { push: null, accuracy: null, consistency: 4 },
        ],
        null,
      ),
    ).toEqual([2, 5]);
  });

  test("a focused band uses only its own low and high", () => {
    expect(
      skillEvolutionDomain(
        [
          { push: 8, accuracy: 1, consistency: 3 },
          { push: 9, accuracy: 1.4, consistency: 6 },
        ],
        "accuracy",
      ),
    ).toEqual([1, 1.4]);
  });

  test("a flat series keeps that floor and lifts the ceiling by 1", () => {
    expect(
      skillEvolutionDomain(
        [
          { push: 4, accuracy: 1, consistency: 3 },
          { push: 5, accuracy: 1, consistency: 3 },
        ],
        "accuracy",
      ),
    ).toEqual([1, 2]);
  });

  test("a focused band with no points falls back to the combined range", () => {
    expect(
      skillEvolutionDomain(
        [{ push: 3, accuracy: null, consistency: 5 }],
        "accuracy",
      ),
    ).toEqual([3, 5]);
  });

  test("an empty series is [0, 1]", () => {
    expect(
      skillEvolutionDomain(
        [{ push: null, accuracy: null, consistency: null }],
        null,
      ),
    ).toEqual([0, 1]);
  });
});
