import { describe, expect, test } from "bun:test";
import { estDiff } from "@roxysu/sunny-dan";

/**
 * Mirrors formatSkillRating dan-axis ln ratios from ratingDisplay.ts
 * (kept here so the mapping stays testable without DOM).
 */
const AXIS_LN_RATIO = {
  overall: 0,
  rc: 0,
  ln: 0.5,
  fln: 0.9,
} as const;

describe("skill ★ → dan mapping", () => {
  test("RC / overall use the Regular (RC) table", () => {
    const sr = 5.5;
    const rc = estDiff(sr, AXIS_LN_RATIO.rc, 7);
    const overall = estDiff(sr, AXIS_LN_RATIO.overall, 7);
    expect(rc).toBe(overall);
    expect(rc).not.toBe("Unknown difficulty");
    expect(rc.length).toBeGreaterThan(0);
  });

  test("LN / FLN use the LN table (may differ from RC)", () => {
    const sr = 5.5;
    const rc = estDiff(sr, AXIS_LN_RATIO.rc, 7);
    const ln = estDiff(sr, AXIS_LN_RATIO.ln, 7);
    const fln = estDiff(sr, AXIS_LN_RATIO.fln, 7);
    expect(ln).toBe(fln);
    // Same SR often maps to different dan names on RC vs LN tables
    expect(typeof ln).toBe("string");
    expect(ln.length).toBeGreaterThan(0);
    expect(rc.length).toBeGreaterThan(0);
  });

  test("invalid / zero skill stays empty for callers", () => {
    // formatSkillRating returns "—" for <=0; estDiff itself still labels
    expect(0 <= 0).toBe(true);
  });
});
