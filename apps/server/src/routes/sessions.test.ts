import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SESSION_LIST_LIMIT,
  MAX_SESSION_LIST_LIMIT,
  clampSessionListLimit,
  clampSessionScoreLimit,
  DEFAULT_SESSION_SCORE_LIMIT,
  MAX_SESSION_SCORE_LIMIT,
} from "./sessions";

describe("clampSessionScoreLimit", () => {
  test("defaults invalid values", () => {
    expect(clampSessionScoreLimit(undefined)).toBe(DEFAULT_SESSION_SCORE_LIMIT);
    expect(clampSessionScoreLimit("nope")).toBe(DEFAULT_SESSION_SCORE_LIMIT);
    expect(clampSessionScoreLimit(0)).toBe(DEFAULT_SESSION_SCORE_LIMIT);
  });

  test("caps at max", () => {
    expect(clampSessionScoreLimit(50)).toBe(50);
    expect(clampSessionScoreLimit(MAX_SESSION_SCORE_LIMIT)).toBe(
      MAX_SESSION_SCORE_LIMIT,
    );
    expect(clampSessionScoreLimit(9999)).toBe(MAX_SESSION_SCORE_LIMIT);
  });
});

describe("clampSessionListLimit (S-NEW-1)", () => {
  test("defaults invalid or missing values to the list default", () => {
    expect(clampSessionListLimit(undefined)).toBe(DEFAULT_SESSION_LIST_LIMIT);
    expect(clampSessionListLimit("nope")).toBe(DEFAULT_SESSION_LIST_LIMIT);
    expect(clampSessionListLimit(0)).toBe(DEFAULT_SESSION_LIST_LIMIT);
    expect(clampSessionListLimit(-5)).toBe(DEFAULT_SESSION_LIST_LIMIT);
  });

  test("accepts string query values", () => {
    expect(clampSessionListLimit("25")).toBe(25);
    expect(clampSessionListLimit("99999")).toBe(MAX_SESSION_LIST_LIMIT);
  });

  test("caps at the hard list max", () => {
    expect(clampSessionListLimit(50)).toBe(50);
    expect(clampSessionListLimit(MAX_SESSION_LIST_LIMIT)).toBe(
      MAX_SESSION_LIST_LIMIT,
    );
    expect(clampSessionListLimit(99999)).toBe(MAX_SESSION_LIST_LIMIT);
  });

  test("the default restores the pre-regression cap, not an unbounded list", () => {
    expect(DEFAULT_SESSION_LIST_LIMIT).toBe(100);
    expect(MAX_SESSION_LIST_LIMIT).toBe(500);
  });
});
