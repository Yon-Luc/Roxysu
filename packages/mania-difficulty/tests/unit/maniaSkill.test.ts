import { describe, expect, test } from "bun:test";
import type { ManiaDifficultyHitObject } from "../../src/adapters/hitObject";
import {
  accuracyAtSkill,
  type AccuracyDifficulties,
} from "../../src/skills/accuracy";
import { createManiaSkill } from "../../src/skills/maniaSkill";

const note = {
  IsHoldNote: false,
  StartTime: 0,
  EndTime: 0,
} as ManiaDifficultyHitObject;

const first: AccuracyDifficulties = {
  BaseDifficulty: 100,
  Multipliers: [1, 0.9, 0.8, 0.7, 0.5, 0.4, 0.3, 0.2, 0],
};

/** 95% multiplier (index 4) is 0.2, against 0.5 on the first note. */
const second: AccuracyDifficulties = {
  BaseDifficulty: 100,
  Multipliers: [1, 0.99, 0.98, 0.97, 0.2, 0.1, 0.05, 0.02, 0],
};

function expectedAccuracy(
  curves: AccuracyDifficulties[],
  skillLevel: number,
): number {
  let sum = 0;
  for (const curve of curves) sum += accuracyAtSkill(curve, skillLevel);
  const count = curves.length;
  return sum / (count - Math.min(count * 0.01, 10));
}

describe("createManiaSkill", () => {
  test("keeps each note's accuracy curve", () => {
    const curves = [first, second];
    let i = 0;
    const skill = createManiaSkill(() => curves[i++]!);
    skill.process(note);
    skill.process(note);

    const skillLevel = 80;
    const perNote = expectedAccuracy(curves, skillLevel);
    const collapsed = expectedAccuracy([first, first], skillLevel);

    expect(skill.AccuracyAtSkillExact(skillLevel)).toBeCloseTo(perNote, 10);
    expect(perNote).not.toBeCloseTo(collapsed, 5);
  });

  test("keeps curves after the multiplier buffer grows", () => {
    const count = 600;
    const curves: AccuracyDifficulties[] = [];
    for (let n = 0; n < count; n++) curves.push(n % 2 === 0 ? first : second);
    let i = 0;
    const skill = createManiaSkill(() => curves[i++]!);
    for (let n = 0; n < count; n++) skill.process(note);

    expect(skill.AccuracyAtSkillExact(80)).toBeCloseTo(
      expectedAccuracy(curves, 80),
      10,
    );
  });
});
