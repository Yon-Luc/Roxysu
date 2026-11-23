import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDb } from "@roxysu/db/client.bun";
import { mastery } from "@roxysu/db/schema";
import { eq } from "drizzle-orm";
import { runMasteryEngine } from "./engine";
import {
  createAnalyticsTestDb,
  seedBeatmap,
  seedScore,
} from "../analyticsTestDb";
import type { Db } from "../../db-runtime";

const CURVE = {
  ppByAccuracy: { "100": 400, "99.5": 360, "97": 280, "95": 220, "93": 180 },
  ppSs: 400,
};

let db: Db;

beforeEach(() => {
  db = createAnalyticsTestDb();
});

afterEach(() => closeDb(db));

describe("runMasteryEngine with failed plays", () => {
  test("a failed play does not set best accuracy, PP, score or misses", async () => {
    seedBeatmap(db, "map-m", CURVE);
    seedScore(db, {
      id: "clear",
      beatmapId: "map-m",
      playedAt: 1_000,
      accuracy: 0.95,
      pp: 220,
      rank: 3,
    });
    seedScore(db, {
      id: "quit",
      beatmapId: "map-m",
      playedAt: 2_000,
      accuracy: 1,
      pp: null,
      rank: -1,
    });

    await runMasteryEngine(db);

    const [row] = db
      .select()
      .from(mastery)
      .where(eq(mastery.beatmapId, "map-m"))
      .all();

    expect(row).toBeDefined();
    expect(row!.playCount).toBe(2);
    expect(row!.bestAccuracy).toBeCloseTo(0.95, 10);
    expect(row!.bestPp).toBe(220);
  });

  test("a map with only failed plays keeps null bests but counts the plays", async () => {
    seedBeatmap(db, "map-only-fail", CURVE);
    seedScore(db, {
      id: "fail-only",
      beatmapId: "map-only-fail",
      playedAt: 1_000,
      accuracy: 0.99,
      pp: null,
      rank: -1,
    });

    await runMasteryEngine(db);

    const [row] = db
      .select()
      .from(mastery)
      .where(eq(mastery.beatmapId, "map-only-fail"))
      .all();

    expect(row).toBeDefined();
    expect(row!.playCount).toBe(1);
    expect(row!.bestAccuracy).toBeNull();
    expect(row!.bestPp).toBeNull();
    expect(row!.bestMisses).toBeNull();
  });
});
