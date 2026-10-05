import { describe, expect, test } from "bun:test";
import { buildHitObjectGraph } from "../../src/adapters/hitObject";
import { ColumnPatternUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils";
import { CrossColumnUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/CrossColumnUtils";
import { RunDampenUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils";
import { RootFinding } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding";
import { ChordUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils";
import { SpeedEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator";
import { TechnicalEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator";
import { JackEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator";
import { CoordinationEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator";
import { ReleaseEvaluator } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator";
import { DiffUtils } from "../../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { calculateManiaDifficulty } from "../../src/index";

describe("ColumnPatternUtils", () => {
  test("SameColumns / SharesColumn", () => {
    expect(ColumnPatternUtils.SameColumns([0, 1], [0, 1])).toBe(true);
    expect(ColumnPatternUtils.SameColumns([0, 1], [0, 2])).toBe(false);
    expect(ColumnPatternUtils.SharesColumn([0, 2], [2, 3])).toBe(true);
    expect(ColumnPatternUtils.SharedColumnCount([0, 1, 2], [1, 2, 3])).toBe(2);
  });

  test("ColumnShift roll", () => {
    expect(ColumnPatternUtils.ColumnShift([0, 1], [1, 2])).toBe(1);
    expect(ColumnPatternUtils.ColumnShift([0, 1], [0, 1])).toBe(0);
  });
});

describe("CrossColumnUtils", () => {
  test("4K boundary sum", () => {
    const s = CrossColumnUtils.SumBoundaryMultipliersBetween(0, 3, 4);
    expect(s).toBeGreaterThan(0);
    expect(CrossColumnUtils.AverageBoundaryMultipliersBetween(0, 0, 4)).toBe(0);
  });
});

describe("RunDampenUtils", () => {
  test("Dampen uses DiffUtils", () => {
    const d = RunDampenUtils.Dampen(1, 5, 0.5);
    expect(d).toBeCloseTo(1.0 - 0.5 * DiffUtils.ReverseLerp(0, 0, 5), 10);
  });
});

describe("RootFinding", () => {
  test("finds root of x-2", () => {
    const root = RootFinding.FindRootExpand((x) => x - 2, 0, 1);
    expect(root).toBeCloseTo(2, 5);
  });
});

describe("SpeedEvaluator + graph", () => {
  test("sparse 4K notes produce finite difficulties", () => {
    const objs = buildHitObjectGraph(4, [
      { column: 0, startMs: 0, endMs: 0 },
      { column: 1, startMs: 500, endMs: 0 },
      { column: 2, startMs: 1000, endMs: 0 },
      { column: 3, startMs: 1500, endMs: 0 },
    ]);
    // C# skips first chart note as a difficulty object → N-1 objects
    expect(objs.length).toBe(3);
    const diffs = objs.map((o) => SpeedEvaluator.EvaluateDifficultyOf(o));
    expect(diffs.every((d) => d >= 0 && Number.isFinite(d))).toBe(true);
    expect(diffs.some((d) => d > 0)).toBe(true);
  });

  test("chord second note is free for speed", () => {
    const objs = buildHitObjectGraph(4, [
      { column: 0, startMs: 0, endMs: 0 },
      { column: 1, startMs: 2, endMs: 0 }, // within CHORD_TOLERANCE_MS
      { column: 2, startMs: 4, endMs: 0 },
    ]);
    // difficulty objects are notes at 2ms and 4ms (first skipped)
    const chordNote = objs.find((o) => o.DeltaTime < ChordUtils.CHORD_TOLERANCE_MS);
    expect(chordNote).toBeTruthy();
    expect(SpeedEvaluator.EvaluateDifficultyOf(chordNote!)).toBe(0);
    expect(ChordUtils.CHORD_TOLERANCE_MS).toBe(8);
  });
});

describe("all evaluators", () => {
  test("run finite on sparse stream", () => {
    const objs = buildHitObjectGraph(4, [
      { column: 0, startMs: 0, endMs: 0 },
      { column: 1, startMs: 200, endMs: 0 },
      { column: 0, startMs: 400, endMs: 0 },
      { column: 1, startMs: 600, endMs: 700 },
    ]);
    for (const o of objs) {
      expect(Number.isFinite(SpeedEvaluator.EvaluateDifficultyOf(o))).toBe(true);
      expect(Number.isFinite(JackEvaluator.EvaluateDifficultyOf(o))).toBe(true);
      expect(Number.isFinite(CoordinationEvaluator.EvaluateDifficultyOf(o))).toBe(
        true,
      );
      expect(Number.isFinite(ReleaseEvaluator.EvaluateDifficultyOf(o))).toBe(true);
      expect(
        Number.isFinite(
          TechnicalEvaluator.EvaluateDifficultyOf(o, 0.1, 0.2, 0.1),
        ),
      ).toBe(true);
    }
  });
});

describe("calculateManiaDifficulty multi-skill", () => {
  test("sparse map has positive skills", () => {
    const r = calculateManiaDifficulty({
      columnCount: 4,
      overallDifficulty: 8,
      notes: [
        { column: 0, startMs: 0, endMs: 0 },
        { column: 1, startMs: 150, endMs: 0 },
        { column: 2, startMs: 300, endMs: 0 },
        { column: 3, startMs: 450, endMs: 0 },
        { column: 0, startMs: 600, endMs: 0 },
      ],
    });
    expect(r.starRating).toBeGreaterThan(0);
    expect(r.speedDifficulty).toBeGreaterThan(0);
    expect(r.technicalDifficulty).toBeGreaterThanOrEqual(0);
    expect(r.jackDifficulty).toBeGreaterThanOrEqual(0);
    expect(r.coordinationDifficulty).toBeGreaterThanOrEqual(0);
  });
});

