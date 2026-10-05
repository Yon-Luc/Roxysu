import { describe, expect, test } from "bun:test";
import { DiffUtils, SQRT2, calculateManiaDifficulty } from "../../src/index";

describe("DiffUtils (generated)", () => {
  test("SQRT2", () => {
    expect(SQRT2).toBeCloseTo(Math.SQRT2, 12);
  });

  test("Smoothstep endpoints", () => {
    expect(DiffUtils.Smoothstep(-1, 0, 1)).toBe(0);
    expect(DiffUtils.Smoothstep(2, 0, 1)).toBe(1);
    expect(DiffUtils.Smoothstep(0.5, 0, 1)).toBeCloseTo(0.5, 10);
  });

  test("Pow int specials", () => {
    expect(DiffUtils.Pow(3, 0)).toBe(1);
    expect(DiffUtils.Pow(3, 1)).toBe(3);
    expect(DiffUtils.Pow(3, 2)).toBe(9);
    expect(DiffUtils.Pow(3, 3)).toBe(27);
  });

  test("Norm", () => {
    expect(DiffUtils.Norm(2, 3, 4)).toBeCloseTo(5, 10);
  });

  test("Logistic overloads", () => {
    const a = DiffUtils.Logistic(0, 1);
    expect(a).toBeCloseTo(1 / (1 + Math.exp(0)), 10);
    const b = DiffUtils.Logistic(0, 0, 1, 1);
    expect(b).toBeCloseTo(0.5, 10);
  });

  test("Erf(0)", () => {
    expect(DiffUtils.Erf(0)).toBe(0);
  });
});

describe("calculateManiaDifficulty stub", () => {
  test("empty", () => {
    const r = calculateManiaDifficulty({
      columnCount: 4,
      overallDifficulty: 8,
      notes: [],
    });
    expect(r.starRating).toBe(0);
    expect(r.upstreamSha).toBeTruthy();
  });

  test("counts notes", () => {
    const r = calculateManiaDifficulty({
      columnCount: 4,
      overallDifficulty: 8,
      notes: [
        { column: 0, startMs: 0, endMs: 0 },
        { column: 1, startMs: 100, endMs: 200 },
      ],
    });
    expect(r.noteCount).toBe(2);
    expect(r.holdNoteCount).toBe(1);
    expect(r.lnRatio).toBeCloseTo(0.5, 10);
  });
});
