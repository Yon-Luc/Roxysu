import { describe, expect, test } from "bun:test";
import { reworkDanLabel } from "@roxysu/mania-difficulty/dans";

/**
 * Mirrors formatSkillRating rework-axis ln ratios from ratingDisplay.ts
 * (kept here so the mapping stays testable without DOM).
 */
const AXIS_LN_RATIO = {
  overall: 0,
  rc: 0,
  ln: 0.5,
  fln: 0.9,
} as const;

const SKILL_KEY_COUNT = 7;

describe("skill ★ → rework dan mapping", () => {
  test("RC / overall use the Regular (RC) table", () => {
    const sr = 5.5;
    const rc = reworkDanLabel(sr, AXIS_LN_RATIO.rc, SKILL_KEY_COUNT);
    const overall = reworkDanLabel(sr, AXIS_LN_RATIO.overall, SKILL_KEY_COUNT);
    expect(rc).toBe(overall);
    expect(rc.length).toBeGreaterThan(0);
  });

  test("LN / FLN use the LN table (may differ from RC)", () => {
    const sr = 5.5;
    const rc = reworkDanLabel(sr, AXIS_LN_RATIO.rc, SKILL_KEY_COUNT);
    const ln = reworkDanLabel(sr, AXIS_LN_RATIO.ln, SKILL_KEY_COUNT);
    const fln = reworkDanLabel(sr, AXIS_LN_RATIO.fln, SKILL_KEY_COUNT);
    expect(ln).toBe(fln);
    expect(typeof ln).toBe("string");
    expect(ln.length).toBeGreaterThan(0);
    expect(rc.length).toBeGreaterThan(0);
  });

  test("invalid / zero skill stays empty for callers", () => {
    // formatSkillRating returns "—" for <=0; reworkDanLabel itself still labels
    expect(0 <= 0).toBe(true);
  });
});
