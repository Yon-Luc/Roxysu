import { describe, expect, test } from "bun:test";
import {
  dominantSkill,
  isSkillLabel,
  skillStars,
  skillStarsFromBreakdown,
  SECONDARY_SKILL_RATIO,
  SKILL_LABELS,
} from "../../src/skills";

describe("skillStars", () => {
  test("reads all five skills and sorts highest first", () => {
    const stars = skillStars({
      starRating: 8,
      speedDifficulty: 5,
      jackDifficulty: 8,
      coordinationDifficulty: 2,
      technicalDifficulty: 3,
      releaseDifficulty: 1,
    });
    expect(stars.map((s) => s.skill)).toEqual([
      "jack",
      "speed",
      "technical",
      "coordination",
      "release",
    ]);
    expect(stars[0]!.star).toBe(8);
  });

  test("missing attributes read as zero", () => {
    expect(skillStars({ starRating: 4, speedDifficulty: 4 })).toHaveLength(5);
    expect(
      skillStars({ starRating: 0 }).every((s) => s.star === 0),
    ).toBe(true);
  });

  test("ties break by canonical order", () => {
    const stars = skillStars({
      starRating: 5,
      speedDifficulty: 5,
      jackDifficulty: 5,
      coordinationDifficulty: 5,
      technicalDifficulty: 5,
      releaseDifficulty: 5,
    });
    expect(stars.map((s) => s.skill)).toEqual([...SKILL_LABELS]);
  });
});

describe("dominantSkill", () => {
  test("picks the top skill with no secondary when one clearly leads", () => {
    const result = dominantSkill({
      starRating: 10,
      speedDifficulty: 10,
      jackDifficulty: 4,
      coordinationDifficulty: 1,
      technicalDifficulty: 1,
      releaseDifficulty: 1,
    });
    expect(result.dominant).toBe("speed");
    expect(result.secondary).toBeNull();
    expect(result.confidence).toBeCloseTo(0.6, 10);
  });

  test("keeps the runner-up when it is within the ratio", () => {
    const result = dominantSkill({
      starRating: 10,
      speedDifficulty: 10,
      jackDifficulty: 10 * SECONDARY_SKILL_RATIO,
      coordinationDifficulty: 1,
      technicalDifficulty: 1,
      releaseDifficulty: 1,
    });
    expect(result.dominant).toBe("speed");
    expect(result.secondary).toBe("jack");
    expect(result.confidence).toBeCloseTo(1 - SECONDARY_SKILL_RATIO, 10);
  });

  test("drops the runner-up just below the ratio", () => {
    const result = dominantSkill({
      starRating: 10,
      jackDifficulty: 10,
      releaseDifficulty: 10 * (SECONDARY_SKILL_RATIO - 0.01),
    });
    expect(result.dominant).toBe("jack");
    expect(result.secondary).toBeNull();
  });

  test("a lone skill with no runner-up is fully confident", () => {
    const result = dominantSkill({ starRating: 6, releaseDifficulty: 6 });
    expect(result.dominant).toBe("release");
    expect(result.confidence).toBe(1);
  });

  test("an empty chart has no dominant skill", () => {
    const result = dominantSkill({ starRating: 0 });
    expect(result.dominant).toBeNull();
    expect(result.secondary).toBeNull();
    expect(result.confidence).toBeNull();
  });

  test("confidence is zero on a perfect tie", () => {
    const result = dominantSkill({
      starRating: 7,
      speedDifficulty: 7,
      jackDifficulty: 7,
      coordinationDifficulty: 7,
      technicalDifficulty: 7,
      releaseDifficulty: 7,
    });
    expect(result.dominant).toBe("speed");
    expect(result.secondary).toBe("jack");
    expect(result.confidence).toBe(0);
  });
});

describe("skillStarsFromBreakdown", () => {
  test("rebuilds from stored attribute keys, ignoring others", () => {
    expect(
      skillStarsFromBreakdown({
        speedDifficulty: 9,
        jackDifficulty: 4,
        starRating: 12,
        variety: 3,
      }),
    ).toEqual([
      { skill: "speed", star: 9 },
      { skill: "jack", star: 4 },
    ]);
  });

  test("handles missing breakdown", () => {
    expect(skillStarsFromBreakdown(null)).toEqual([]);
    expect(skillStarsFromBreakdown(undefined)).toEqual([]);
    expect(skillStarsFromBreakdown({})).toEqual([]);
  });
});

describe("isSkillLabel", () => {
  test("accepts the five skills and rejects retired pattern names", () => {
    for (const skill of SKILL_LABELS) expect(isSkillLabel(skill)).toBe(true);
    for (const old of ["jack", "jumpstream", "chordjack", "bracket", "chordstream", "stream", "delay", "handstream", "mixed"]) {
      if ((SKILL_LABELS as readonly string[]).includes(old)) continue;
      expect(isSkillLabel(old)).toBe(false);
    }
  });
});