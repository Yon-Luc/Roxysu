import { describe, expect, test } from "bun:test";
import { clampOverlayLimit, DEFAULT_OVERLAY_LIMIT } from "./overlay";

describe("clampOverlayLimit", () => {
  test("defaults invalid values", () => {
    expect(clampOverlayLimit(undefined)).toBe(DEFAULT_OVERLAY_LIMIT);
    expect(clampOverlayLimit("nope")).toBe(DEFAULT_OVERLAY_LIMIT);
    expect(clampOverlayLimit(0)).toBe(DEFAULT_OVERLAY_LIMIT);
  });

  test("caps at 25", () => {
    expect(clampOverlayLimit(8)).toBe(8);
    expect(clampOverlayLimit(25)).toBe(25);
    expect(clampOverlayLimit(99)).toBe(25);
  });
});
