import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AXIS_THRESHOLDS,
  normalizeAxisThresholds,
  validateAxisThresholdsInput,
} from "./axisThresholds";
import { classifyMapAxis } from "./axis";

describe("normalizeAxisThresholds", () => {
  test("defaults when both missing", () => {
    expect(normalizeAxisThresholds(null, null)).toEqual(DEFAULT_AXIS_THRESHOLDS);
  });

  test("keeps valid pair", () => {
    expect(normalizeAxisThresholds(0.15, 0.7)).toEqual({ ln: 0.15, fln: 0.7 });
  });

  test("falls back when inverted pair provided", () => {
    expect(normalizeAxisThresholds(0.9, 0.2)).toEqual(DEFAULT_AXIS_THRESHOLDS);
  });
});

describe("validateAxisThresholdsInput", () => {
  test("accepts defaults", () => {
    const v = validateAxisThresholdsInput(0.2, 0.8);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.thresholds).toEqual({ ln: 0.2, fln: 0.8 });
  });

  test("rejects ln >= fln", () => {
    const v = validateAxisThresholdsInput(0.5, 0.5);
    expect(v.ok).toBe(false);
  });

  test("rejects out of range", () => {
    expect(validateAxisThresholdsInput(0, 0.8).ok).toBe(false);
    expect(validateAxisThresholdsInput(0.2, 1.5).ok).toBe(false);
  });
});

describe("classifyMapAxis with custom thresholds", () => {
  const t = { ln: 0.3, fln: 0.6 };

  test("rice below ln", () => {
    expect(classifyMapAxis(0.29, t)).toBe("rc");
  });

  test("ln band", () => {
    expect(classifyMapAxis(0.3, t)).toBe("ln");
    expect(classifyMapAxis(0.59, t)).toBe("ln");
  });

  test("fln at/above fln", () => {
    expect(classifyMapAxis(0.6, t)).toBe("fln");
    expect(classifyMapAxis(1, t)).toBe("fln");
  });

  test("null ratio is rice", () => {
    expect(classifyMapAxis(null, t)).toBe("rc");
  });
});
