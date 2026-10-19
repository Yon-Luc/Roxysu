import { describe, expect, test } from "bun:test";
import {
  addReplayAccuracy,
  emptyReplayAccuracy,
  replayAccuracy,
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