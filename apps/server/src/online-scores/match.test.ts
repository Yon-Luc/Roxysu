import { describe, expect, test } from "bun:test";
import { classifyRankedBest, type RankedBest } from "./match";

function best(patch: Partial<RankedBest> = {}): RankedBest {
  return {
    id: 10,
    legacyScoreId: 3,
    beatmapId: 99,
    checksum: "abc",
    accuracy: 0.98,
    pp: 200,
    maxCombo: 400,
    totalScore: 900_000,
    totalScoreWithoutMods: 900_000,
    legacyTotalScore: 800_000,
    rank: "S",
    modsJson: "[]",
    statistics: { great: 1 },
    maximumStatistics: null,
    endedAt: "2024-01-01T00:00:00Z",
    userId: 7,
    username: "player",
    isLegacy: false,
    ...patch,
  };
}

const beatmap = {
  id: "map-1",
  onlineId: 99,
  md5Hash: "abc",
  hash: "sha",
  totalObjectCount: 400,
  rulesetShortName: "mania",
};

describe("classifyRankedBest", () => {
  test("matches an existing online id", () => {
    const result = classifyRankedBest(best(), {
      onlineIds: new Set([10]),
      legacyIds: new Set(),
      fingerprints: [],
      beatmapsByOnlineId: new Map(),
    });
    expect(result.kind).toBe("already");
  });

  test("adds when the checksum matches", () => {
    const result = classifyRankedBest(best(), {
      onlineIds: new Set(),
      legacyIds: new Set(),
      fingerprints: [],
      beatmapsByOnlineId: new Map([[99, [beatmap]]]),
    });
    expect(result.kind).toBe("add");
    expect(result.beatmap?.id).toBe("map-1");
  });

  test("attaches to the current file when the checksum differs", () => {
    const result = classifyRankedBest(best({ checksum: "other" }), {
      onlineIds: new Set(),
      legacyIds: new Set(),
      fingerprints: [],
      beatmapsByOnlineId: new Map([[99, [beatmap]]]),
    });
    expect(result.kind).toBe("add-current-version");
  });

  test("skips a map that is not installed", () => {
    const result = classifyRankedBest(best(), {
      onlineIds: new Set(),
      legacyIds: new Set(),
      fingerprints: [],
      beatmapsByOnlineId: new Map(),
    });
    expect(result.kind).toBe("skipped");
  });
});
