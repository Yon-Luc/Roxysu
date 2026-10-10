import { describe, expect, it } from "bun:test";
import {
  comparePbRank,
  pickPbCompare,
  topTwoByBeatmap,
} from "./pbCompare";

function score(
  partial: Partial<{
    id: string;
    beatmapId: string;
    accuracy: number;
    pp: number | null;
    maxCombo: number;
    mods: string | null;
    rank: number;
    playedAt: Date;
  }> & { id: string },
) {
  return {
    beatmapId: "map-a",
    accuracy: 0.95,
    pp: 100,
    maxCombo: 500,
    mods: null,
    rank: 1,
    playedAt: new Date("2024-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("comparePbRank", () => {
  it("prefers higher pp", () => {
    const a = score({ id: "a", pp: 120 });
    const b = score({ id: "b", pp: 100 });
    expect(comparePbRank(a, b)).toBeLessThan(0);
  });

  it("breaks pp ties with accuracy then earlier play", () => {
    const earlier = score({
      id: "a",
      pp: 100,
      accuracy: 0.99,
      playedAt: new Date("2024-01-01T00:00:00Z"),
    });
    const later = score({
      id: "b",
      pp: 100,
      accuracy: 0.99,
      playedAt: new Date("2024-01-02T00:00:00Z"),
    });
    expect(comparePbRank(earlier, later)).toBeLessThan(0);
  });
});

describe("topTwoByBeatmap / pickPbCompare", () => {
  const rows = [
    score({ id: "old", pp: 90, playedAt: new Date("2024-01-01") }),
    score({ id: "pb", pp: 120, playedAt: new Date("2024-01-03") }),
    score({ id: "mid", pp: 100, playedAt: new Date("2024-01-02") }),
  ];
  const tops = topTwoByBeatmap(rows);

  it("keeps top two by rank", () => {
    const [first, second] = tops.get("map-a")!;
    expect(first.id).toBe("pb");
    expect(second?.id).toBe("mid");
  });

  it("returns previous best for a PB score", () => {
    const compare = pickPbCompare({
      isPb: true,
      scoreId: "pb",
      top: tops.get("map-a"),
    });
    expect(compare?.kind).toBe("previous");
    expect(compare?.id).toBe("mid");
  });

  it("returns current PB for a non-PB score", () => {
    const compare = pickPbCompare({
      isPb: false,
      scoreId: "mid",
      top: tops.get("map-a"),
    });
    expect(compare?.kind).toBe("current");
    expect(compare?.id).toBe("pb");
  });

  it("returns null when PB is the only score on the map", () => {
    const alone = topTwoByBeatmap([score({ id: "only", pp: 50 })]);
    expect(
      pickPbCompare({
        isPb: true,
        scoreId: "only",
        top: alone.get("map-a"),
      }),
    ).toBeNull();
  });
});
