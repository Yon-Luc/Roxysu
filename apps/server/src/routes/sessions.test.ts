import { describe, expect, test } from "bun:test";
import {
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
