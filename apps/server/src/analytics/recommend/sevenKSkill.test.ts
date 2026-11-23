import { describe, expect, test } from "bun:test";
import {
  estimateSevenKSkillFromPlays,
  __testing,
  type SkillPlayRow,
} from "./sevenKSkill";

const {
  aggregateAccBandMaps,
  buildSampleKeys,
  endOfUtcDayMs,
  endOfUtcWeekMs,
  utcDayKey,
  utcWeekStartKey,
  PUSH_ACC_MIN,
  PUSH_ACC_MAX,
  topPlaysInBand,
  bestPlayPerMap,
} = __testing;

function play(
  overrides: Partial<SkillPlayRow> & Pick<SkillPlayRow, "beatmapId" | "playedAt">,
): SkillPlayRow {
  return {
    accuracy: 0.93,
    reworkStar: 5,
    lnRatio: 0.1,
    ...overrides,
  };
}

describe("aggregateAccBandMaps", () => {
  test("groups maps in the push accuracy band", () => {
    const maps = aggregateAccBandMaps(
      [
        play({ beatmapId: "a", playedAt: 1000, accuracy: 0.92, reworkStar: 4 }),
        play({ beatmapId: "a", playedAt: 2000, accuracy: 0.94, reworkStar: 4 }),
        play({ beatmapId: "b", playedAt: 3000, accuracy: 0.99, reworkStar: 6 }), // accuracy band
        play({ beatmapId: "c", playedAt: 4000, accuracy: 0.85, reworkStar: 3 }), // below push
      ],
      PUSH_ACC_MIN,
      PUSH_ACC_MAX,
    );

    expect(maps).toHaveLength(1);
    expect(maps[0]!.beatmapId).toBe("a");
    expect(maps[0]!.bandPlays).toBe(2);
    expect(maps[0]!.avgBandAcc).toBeCloseTo(0.93, 5);
    expect(maps[0]!.lastPlayedAt).toBe(2000);
  });
});

describe("topPlaysInBand", () => {
  test("uses only the best play per map", () => {
    const top = topPlaysInBand(
      [
        play({
          beatmapId: "a",
          playedAt: 1000,
          accuracy: 0.91,
          reworkStar: 8,
        }),
        play({
          beatmapId: "a",
          playedAt: 2000,
          accuracy: 0.94,
          reworkStar: 8,
        }),
        play({
          beatmapId: "b",
          playedAt: 3000,
          accuracy: 0.92,
          reworkStar: 9,
        }),
      ],
      PUSH_ACC_MIN,
      10,
    );

    expect(top).toHaveLength(2);
    expect(top.find((p) => p.beatmapId === "a")!.accuracy).toBeCloseTo(0.94, 5);
    expect(top[0]!.beatmapId).toBe("b");
  });

  test("without ceil, keeps maps when best clear is above the core band", () => {
    const top = topPlaysInBand(
      [
        play({
          beatmapId: "a",
          playedAt: 1000,
          accuracy: 0.97,
          reworkStar: 8.5,
          lnRatio: 0.5,
        }),
        play({
          beatmapId: "b",
          playedAt: 2000,
          accuracy: 0.92,
          reworkStar: 8,
          lnRatio: 0.5,
        }),
      ],
      PUSH_ACC_MIN,
      10,
    );

    expect(top).toHaveLength(2);
    expect(top.map((p) => p.beatmapId).sort()).toEqual(["a", "b"]);
  });

  test("with ceil, excludes clears at or above the band max", () => {
    const top = topPlaysInBand(
      [
        play({
          beatmapId: "a",
          playedAt: 1000,
          accuracy: 0.97,
          reworkStar: 8.5,
          lnRatio: 0.5,
        }),
        play({
          beatmapId: "b",
          playedAt: 2000,
          accuracy: 0.92,
          reworkStar: 8,
          lnRatio: 0.5,
        }),
      ],
      PUSH_ACC_MIN,
      10,
      undefined,
      undefined,
      PUSH_ACC_MAX,
    );

    expect(top).toHaveLength(1);
    expect(top[0]!.beatmapId).toBe("b");
  });
});

describe("estimateSevenKSkillFromPlays as-of", () => {
  test("excludes plays after asOf when computing bands", () => {
    const day1 = Date.UTC(2024, 0, 1, 12);
    const day2 = Date.UTC(2024, 0, 10, 12);
    const day3 = Date.UTC(2024, 0, 20, 12);
    const topPlays = 3;

    const early: SkillPlayRow[] = [];
    for (let i = 0; i < topPlays; i++) {
      early.push(
        play({
          beatmapId: `early-${i}`,
          playedAt: day1 + i,
          accuracy: 0.92,
          reworkStar: 4,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      early.push(
        play({
          beatmapId: `comfort-${i}`,
          playedAt: day1 + 100 + i,
          accuracy: 0.97,
          reworkStar: 4.2,
        }),
      );
    }

    const latePush = play({
      beatmapId: "late",
      playedAt: day3,
      accuracy: 0.92,
      reworkStar: 9,
    });

    const asOfMid = estimateSevenKSkillFromPlays([...early, latePush], {
      asOfMs: endOfUtcDayMs(utcDayKey(day2)),
      topPlays,
      coldStartFromPlaysOnly: true,
    });
    const asOfLate = estimateSevenKSkillFromPlays([...early, latePush], {
      asOfMs: endOfUtcDayMs(utcDayKey(day3)),
      topPlays,
      coldStartFromPlaysOnly: true,
    });

    expect(asOfMid.peakOverall).toBeGreaterThan(0);
    expect(asOfMid.clearRcMaps + asOfMid.clearLnMaps + asOfMid.clearFlnMaps).toBe(
      topPlays,
    );
    expect(asOfLate.peakOverall).toBeGreaterThanOrEqual(asOfMid.peakOverall);
    expect(asOfLate.clearRcMaps).toBeGreaterThanOrEqual(asOfMid.clearRcMaps);
  });

  test("requires full topN plays in band before reporting axis push skill", () => {
    const lnPlays: SkillPlayRow[] = [];
    for (let i = 0; i < 15; i++) {
      lnPlays.push(
        play({
          beatmapId: `ln-${i}`,
          playedAt: 1000 + i,
          accuracy: 0.92,
          reworkStar: 8.5,
          lnRatio: 0.5,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      lnPlays.push(
        play({
          beatmapId: `comfort-${i}`,
          playedAt: 2000 + i,
          accuracy: 0.85,
          reworkStar: 7,
          lnRatio: 0.5,
        }),
      );
    }

    const skill = estimateSevenKSkillFromPlays(lnPlays, { topPlays: 20 });
    expect(skill.clearLnMaps).toBe(15);
    expect(skill.peakLn).toBe(0);
    expect(skill.peakOverall).toBe(0);
  });

  test("empty before any plays", () => {
    const skill = estimateSevenKSkillFromPlays(
      [play({ beatmapId: "a", playedAt: 2000 })],
      { asOfMs: 1000, coldStartFromPlaysOnly: true },
    );
    expect(skill.overall).toBe(0);
    expect(skill.peakOverall).toBe(0);
    expect(skill.coldStart).toBe(true);
  });
});

describe("buildSampleKeys", () => {
  test("day granularity yields one key per day in range", () => {
    const now = Date.UTC(2024, 5, 15, 18);
    const keys = buildSampleKeys("day", 7, now);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2024-06-09");
    expect(keys[6]).toBe("2024-06-15");
  });

  test("day granularity caps around 60 points for long ranges", () => {
    const now = Date.UTC(2024, 5, 15, 18);
    const keys = buildSampleKeys("day", 180, now);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.length).toBeLessThanOrEqual(60);
  });

  test("week granularity yields Monday week starts", () => {
    const now = Date.UTC(2024, 5, 15, 18); // Sat
    const keys = buildSampleKeys("week", 21, now); // ~3 weeks
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(Date.UTC(y!, m! - 1, d!));
      expect(date.getUTCDay()).toBe(1); // Monday
    }
  });

  test("week granularity caps around 60 points for all-time ranges", () => {
    const now = Date.UTC(2024, 5, 15, 18);
    const keys = buildSampleKeys("week", 3 * 365, now); // ~157 weeks
    expect(keys.length).toBeLessThanOrEqual(60);
    expect(keys.length).toBeGreaterThan(1);
    // Sampled means skipping weeks: the key count must be well under total weeks.
    expect(keys.length).toBeLessThan(157);
  });
});

describe("utc week helpers", () => {
  test("week start and end align to Mon–Sun UTC", () => {
    const sat = Date.UTC(2024, 5, 15); // Sat Jun 15 2024
    expect(utcWeekStartKey(sat)).toBe("2024-06-10");
    const end = endOfUtcWeekMs("2024-06-10");
    expect(utcDayKey(end)).toBe("2024-06-16");
  });
});

describe("comfort recency weight", () => {
  test("recent plays weigh more than old ones, not hardest-first", () => {
    // Five graded plays whose difficulty rises with time (an improving
    // player). `topRatedPlays` orders them hardest-first; the recency decay
    // must still follow play time so the newest play carries the full
    // weight. Equal accuracy keeps the accuracy factor out of the ratio.
    const stars = [5, 5.25, 5.5, 5.75, 6];
    const plays = stars.map((reworkStar, i) =>
      play({ beatmapId: `m${i}`, playedAt: 1000 + i, reworkStar }),
    );
    const profile = estimateSevenKSkillFromPlays(plays);
    // Newest (★6) weighted 1, oldest (★5) weighted 0.95^4:
    // (6·1 + 5.75·0.95 + 5.5·0.9025 + 5.25·0.857375 + 5·0.81450625) / Σ.
    // The pre-fix value (hardest play decayed hardest) was ≈5.4744.
    expect(profile.overall).toBeCloseTo(5.5256175, 6);
    expect(profile.rc).toBeCloseTo(5.5256175, 6);
  });
});

describe("comfort with no weighted evidence", () => {
  test("plays below 80% accuracy contribute nothing", () => {
    // Every rated play is a map the player cannot clear. Averaging their star
    // rating would report comfort at a level they have never reached, and
    // Deficit/Skillset would recommend around it.
    const plays = [7, 7.5, 8, 8.5, 9, 9.5].map((reworkStar, i) =>
      play({
        beatmapId: `over-${i}`,
        playedAt: 1000 + i,
        accuracy: 0.75,
        reworkStar,
      }),
    );
    const profile = estimateSevenKSkillFromPlays(plays);
    expect(profile.overall).toBe(0);
    expect(profile.rc).toBe(0);
    expect(profile.samplePlays).toBe(6);
  });

  test("sub-80% plays do not drag the comfort of graded plays", () => {
    const graded = [5, 5.1, 5.2, 5.3, 5.4].map((reworkStar, i) =>
      play({
        beatmapId: `clear-${i}`,
        playedAt: 2000 + i,
        accuracy: 0.95,
        reworkStar,
      }),
    );
    const failed = play({
      beatmapId: "overreach",
      playedAt: 1000,
      accuracy: 0.6,
      reworkStar: 9,
    });
    const withFail = estimateSevenKSkillFromPlays([...graded, failed]);
    const without = estimateSevenKSkillFromPlays(graded);
    expect(withFail.overall).toBeCloseTo(without.overall, 10);
  });
});
