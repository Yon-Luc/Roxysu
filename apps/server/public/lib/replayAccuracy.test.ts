import { describe, expect, test } from "bun:test";
import { emptyJudgmentCounts } from "@roxysu/mania-judge";
import { parseScoreMods } from "@server/replay/mods";
import { simulateTaikoJudgments } from "@server/replay/taikoJudge";
import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import {
  addReplayAccuracy,
  emptyReplayAccuracy,
  hudJudgments,
  replayAccuracy,
  taikoHudJudgments,
  taikoPlayfieldJudgments,
} from "./replayAccuracy";

const MANIA_WEIGHT = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
} as const;

describe("replayAccuracy", () => {
  test("sums standard slices and ignores a tail miss", () => {
    const acc = emptyReplayAccuracy();
    addReplayAccuracy(
      acc,
      { result: "perfect", accuracyPoints: 300, accuracyMax: 300 },
      MANIA_WEIGHT,
    );
    addReplayAccuracy(
      acc,
      { result: "miss", accuracyPoints: 0, accuracyMax: 30 },
      MANIA_WEIGHT,
    );
    addReplayAccuracy(
      acc,
      { result: "miss", accuracyPoints: 0, accuracyMax: 0 },
      MANIA_WEIGHT,
    );
    expect(replayAccuracy(acc, 305)).toBeCloseTo(300 / 330);
  });

  test("a banana miss does not change catch accuracy", () => {
    const acc = emptyReplayAccuracy();
    addReplayAccuracy(
      acc,
      { result: "great", accuracyPoints: 1, accuracyMax: 1 },
      MANIA_WEIGHT,
    );
    addReplayAccuracy(
      acc,
      { result: "miss", accuracyPoints: 0, accuracyMax: 0 },
      MANIA_WEIGHT,
    );
    expect(replayAccuracy(acc, 305)).toBe(1);
  });

  test("mania still weights marvelous above a 300", () => {
    const acc = emptyReplayAccuracy();
    addReplayAccuracy(acc, { result: "perfect" }, MANIA_WEIGHT);
    addReplayAccuracy(acc, { result: "great" }, MANIA_WEIGHT);
    expect(replayAccuracy(acc, 305)).toBeCloseTo((305 + 300) / (2 * 305));
  });
});
describe("taiko HUD rows", () => {
  const TAIKO_WEIGHT = {
    perfect: 300,
    great: 300,
    good: 150,
    ok: 150,
    meh: 0,
    miss: 0,
  } as const;

  function simulate() {
    return simulateTaikoJudgments({
      hitObjects: [
        { type: "hit", timeMs: 1000, color: "don", large: false },
        { type: "hit", timeMs: 1500, color: "kat", large: false },
        {
          type: "drumroll",
          timeMs: 2000,
          endMs: 2400,
          large: false,
          ticks: [{ tMs: 2100 }, { tMs: 2200 }, { tMs: 2300 }],
        },
        { type: "swell", timeMs: 3000, endMs: 3500 },
        { type: "hit", timeMs: 4000, color: "don", large: false },
      ],
      frames: [
        { tMs: 0, keys: 0 },
        { tMs: 1000, keys: 1 },
        { tMs: 1010, keys: 0 },
        // kat at 1500 is missed; every roll tick and swell press lands
        { tMs: 2100, keys: 1 },
        { tMs: 2110, keys: 0 },
        { tMs: 2200, keys: 1 },
        { tMs: 2210, keys: 0 },
        { tMs: 2300, keys: 1 },
        { tMs: 2310, keys: 0 },
        { tMs: 3100, keys: 1 },
        { tMs: 3110, keys: 0 },
        { tMs: 3200, keys: 1 },
        { tMs: 3210, keys: 0 },
        { tMs: 4000, keys: 1 },
        { tMs: 4010, keys: 0 },
      ],
      overallDifficulty: 5,
      mods: parseScoreMods("[]"),
    });
  }

  function hudAccuracy(
    rows: Array<{ result: ReplayJudgmentResult }>,
    counts: boolean,
  ) {
    const acc = emptyReplayAccuracy();
    const tally = emptyJudgmentCounts();
    for (const j of rows) {
      addReplayAccuracy(acc, j, TAIKO_WEIGHT);
      tally[j.result] += 1;
    }
    return { accuracy: replayAccuracy(acc, 300), tally: counts ? tally : null };
  }

  test("fixture includes roll and swell rows", () => {
    const { judgments } = simulate();
    const kinds = new Set(judgments.map((j) => j.kind));
    expect(kinds.has("roll")).toBe(true);
    expect(kinds.has("swell")).toBe(true);
    expect(kinds.has("hit")).toBe(true);
  });

  test("hit-only rows reproduce the simulated accuracy and counts", () => {
    const { judgments, summary } = simulate();
    const rows = taikoHudJudgments(judgments);
    expect(rows.every((j) => j.kind === "hit")).toBe(true);
    const hud = hudAccuracy(rows, true);
    expect(hud.accuracy).toBeCloseTo(summary.accuracy, 10);
    expect(hud.tally).toEqual(summary.counts);
  });

  test("counting every row diverges from the simulated accuracy", () => {
    const { judgments, summary } = simulate();
    const hud = hudAccuracy(judgments, false);
    expect(hud.accuracy).not.toBeCloseTo(summary.accuracy, 5);
  });

  test("hudJudgments filters only taiko", () => {
    const { judgments } = simulate();
    expect(hudJudgments("taiko", judgments).length).toBeLessThan(
      judgments.length,
    );
    expect(hudJudgments("mania", judgments)).toBe(judgments);
    expect(hudJudgments(undefined, judgments)).toBe(judgments);
  });

  test("taikoPlayfieldJudgments drops standard slider kinds", () => {
    const rows = taikoPlayfieldJudgments([
      { kind: "hit" },
      { kind: "roll" },
      { kind: "head" },
      { kind: "tail" },
      {},
    ]);
    expect(rows).toHaveLength(3);
  });
});
