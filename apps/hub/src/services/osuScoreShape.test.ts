import { describe, expect, test } from "bun:test";
import { normalizeRankedBest } from "./osuScoreShape";
import { resetOsuBudgetForTests, acquireOsuSlot, releaseOsuSlot, osuBudgetSnapshot } from "./osuBudget";

describe("normalizeRankedBest", () => {
  test("reads the 20220705 score shape", () => {
    const score = normalizeRankedBest({
      id: 42,
      user_id: 7,
      accuracy: 0.99,
      pp: 123.4,
      max_combo: 500,
      total_score: 1_000_000,
      legacy_score_id: 9,
      rank: "X",
      ended_at: "2024-06-01T00:00:00Z",
      mods: [{ acronym: "DT" }],
      statistics: { perfect: 500 },
      beatmap: { id: 99, checksum: "ABC" },
      user: { username: "player" },
    });
    expect(score?.id).toBe(42);
    expect(score?.checksum).toBe("abc");
    expect(score?.statistics.perfect).toBe(500);
    expect(score?.modsJson).toContain("DT");
  });

  test("maps stable count_* statistics", () => {
    const score = normalizeRankedBest({
      id: 1,
      score: 800000,
      max_combo: 10,
      created_at: "2014-01-01T00:00:00Z",
      statistics: { count_geki: 4, count_300: 3, count_miss: 1 },
      beatmap: { id: 5 },
    });
    expect(score?.statistics.perfect).toBe(4);
    expect(score?.statistics.great).toBe(3);
    expect(score?.statistics.miss).toBe(1);
    expect(score?.isLegacy).toBe(true);
  });
});

describe("osu budget gate", () => {
  test("counts an acquired slot", async () => {
    resetOsuBudgetForTests();
    await acquireOsuSlot(() => 1_000);
    const snap = osuBudgetSnapshot(1_000);
    expect(snap.callsThisMinute).toBe(1);
    expect(snap.inFlight).toBe(1);
    releaseOsuSlot();
    expect(osuBudgetSnapshot(1_000).inFlight).toBe(0);
  });
});
