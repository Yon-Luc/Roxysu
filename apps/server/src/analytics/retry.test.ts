import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDb } from "@roxysu/db/client.bun";
import { scoreMetrics } from "@roxysu/db/schema";
import { runRetryEngine } from "./retry";
import {
  createAnalyticsTestDb,
  seedBeatmap,
  seedScore,
} from "./analyticsTestDb";
import type { Db } from "../db-runtime";
import { loadPbCompareForBeatmaps } from "../scores/pbCompare";

const CURVE = {
  ppByAccuracy: { "100": 400, "99.5": 360, "97": 280, "95": 220, "93": 180 },
  ppSs: 400,
};
const DT = JSON.stringify([{ acronym: "DT" }]);
const MR = JSON.stringify([{ acronym: "MR" }]);

let db: Db;

beforeEach(() => {
  db = createAnalyticsTestDb();
});

afterEach(() => closeDb(db));

async function pbIds(): Promise<string[]> {
  const rows = await db.select().from(scoreMetrics);
  return rows
    .filter((r) => r.isPb)
    .map((r) => r.scoreId)
    .sort();
}

describe("runRetryEngine PB ranking", () => {
  test("estimated NM PP beats a tiny stored PP", async () => {
    seedBeatmap(db, "map-a", CURVE);
    seedScore(db, { id: "null-pp", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.97, pp: null });
    seedScore(db, { id: "tiny-pp", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.5, pp: 1 });

    await runRetryEngine(db);
    expect(await pbIds()).toEqual(["null-pp"]);
  });

  test("estimated mirror-only PP counts like no-mod", async () => {
    seedBeatmap(db, "map-a", CURVE);
    seedScore(db, { id: "stored", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.9, pp: 50 });
    seedScore(db, { id: "mirror", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.97, pp: null, mods: MR });

    await runRetryEngine(db);
    expect(await pbIds()).toEqual(["mirror"]);
  });

  test("rate-mod score without stored PP is not estimated", async () => {
    seedBeatmap(db, "map-a", CURVE);
    seedScore(db, { id: "dt", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.99, pp: null, mods: DT });
    seedScore(db, { id: "tiny-pp", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.5, pp: 1 });

    await runRetryEngine(db);
    expect(await pbIds()).toEqual(["tiny-pp"]);
  });

  test("without a curve a null-PP score still loses to any stored PP", async () => {
    seedBeatmap(db, "map-a");
    seedScore(db, { id: "null-pp", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.99, pp: null });
    seedScore(db, { id: "tiny-pp", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.5, pp: 1 });

    await runRetryEngine(db);
    expect(await pbIds()).toEqual(["tiny-pp"]);
  });

  test("ties on resolved PP fall back to accuracy, then the earlier play", async () => {
    seedBeatmap(db, "map-a");
    seedScore(db, { id: "first", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.9, pp: 100 });
    seedScore(db, { id: "same", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.9, pp: 100 });
    seedScore(db, { id: "more-acc", beatmapId: "map-a", playedAt: 3_000, accuracy: 0.95, pp: 100 });

    await runRetryEngine(db);
    expect(await pbIds()).toEqual(["more-acc"]);
  });

  test("scoped run ranks with curves for the scoped beatmaps", async () => {
    seedBeatmap(db, "map-a", CURVE);
    seedBeatmap(db, "map-b", CURVE);
    seedScore(db, { id: "a-null", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.97, pp: null });
    seedScore(db, { id: "a-tiny", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.5, pp: 1 });
    seedScore(db, { id: "b-null", beatmapId: "map-b", playedAt: 3_000, accuracy: 0.97, pp: null });
    seedScore(db, { id: "b-tiny", beatmapId: "map-b", playedAt: 4_000, accuracy: 0.5, pp: 1 });

    await runRetryEngine(db, { beatmapIds: ["map-a"] });
    expect(await pbIds()).toEqual(["a-null"]);
  });
});

describe("session pbCompare agrees with is_pb", () => {
  test("batched lookup ranks null-PP NM scores by estimated PP", async () => {
    seedBeatmap(db, "map-a", CURVE);
    seedScore(db, { id: "null-pp", beatmapId: "map-a", playedAt: 1_000, accuracy: 0.97, pp: null });
    seedScore(db, { id: "tiny-pp", beatmapId: "map-a", playedAt: 2_000, accuracy: 0.5, pp: 1 });

    await runRetryEngine(db);
    const tops = await loadPbCompareForBeatmaps(db, ["map-a"]);
    const [first, second] = tops.get("map-a")!;
    expect(first.id).toBe("null-pp");
    expect(first.pp).toBe(280);
    expect(second?.id).toBe("tiny-pp");
    expect(await pbIds()).toEqual([first.id]);
  });
});
