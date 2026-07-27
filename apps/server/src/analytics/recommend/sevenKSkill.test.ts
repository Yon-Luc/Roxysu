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
    sunnyStar: 5,
    lnRatio: 0.1,
    ...overrides,
  };
}

describe("aggregateAccBandMaps", () => {
  test("groups maps in the push accuracy band", () => {
    const maps = aggregateAccBandMaps(
      [
        play({ beatmapId: "a", playedAt: 1000, accuracy: 0.92, sunnyStar: 4 }),
        play({ beatmapId: "a", playedAt: 2000, accuracy: 0.94, sunnyStar: 4 }),
        play({ beatmapId: "b", playedAt: 3000, accuracy: 0.99, sunnyStar: 6 }), // accuracy band
        play({ beatmapId: "c", playedAt: 4000, accuracy: 0.85, sunnyStar: 3 }), // below push
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
          sunnyStar: 8,
        }),
        play({
          beatmapId: "a",
          playedAt: 2000,
          accuracy: 0.94,
          sunnyStar: 8,
        }),
        play({
          beatmapId: "b",
          playedAt: 3000,
          accuracy: 0.92,
          sunnyStar: 9,
        }),
      ],
      PUSH_ACC_MIN,
      10,
    );

    expect(top).toHaveLength(2);
    expect(top.find((p) => p.beatmapId === "a")!.accuracy).toBeCloseTo(0.94, 5);
    expect(top[0]!.beatmapId).toBe("b");
  });

  test("keeps maps when best clear is above the core band", () => {
    const top = topPlaysInBand(
      [
        play({
          beatmapId: "a",
          playedAt: 1000,
          accuracy: 0.97,
          sunnyStar: 8.5,
          lnRatio: 0.5,
        }),
        play({
          beatmapId: "b",
          playedAt: 2000,
          accuracy: 0.92,
          sunnyStar: 8,
          lnRatio: 0.5,
        }),
      ],
      PUSH_ACC_MIN,
      10,
    );

    expect(top).toHaveLength(2);
    expect(top.map((p) => p.beatmapId).sort()).toEqual(["a", "b"]);
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
          sunnyStar: 4,
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      early.push(
        play({
          beatmapId: `comfort-${i}`,
          playedAt: day1 + 100 + i,
          accuracy: 0.97,
          sunnyStar: 4.2,
        }),
      );
    }

    const latePush = play({
      beatmapId: "late",
      playedAt: day3,
      accuracy: 0.92,
      sunnyStar: 9,
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
          sunnyStar: 8.5,
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
          sunnyStar: 7,
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
});

describe("utc week helpers", () => {
  test("week start and end align to Mon–Sun UTC", () => {
    const sat = Date.UTC(2024, 5, 15); // Sat Jun 15 2024
    expect(utcWeekStartKey(sat)).toBe("2024-06-10");
    const end = endOfUtcWeekMs("2024-06-10");
    expect(utcDayKey(end)).toBe("2024-06-16");
  });
});
