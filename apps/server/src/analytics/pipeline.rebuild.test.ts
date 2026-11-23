import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDb } from "@roxysu/db/client.bun";
import { imports, scoreMetrics } from "@roxysu/db/schema";
import {
  loadAnalyticsDelta,
  needsFullRebuild,
  type AnalyticsDelta,
} from "./pipeline";
import {
  createAnalyticsTestDb,
  seedBeatmap,
  seedScore,
} from "./analyticsTestDb";
import type { Db } from "../db-runtime";

const CURVE = {
  ppByAccuracy: { "100": 400, "95": 220 },
  ppSs: 400,
};

const cleanDelta: AnalyticsDelta = {
  scoreIds: [],
  beatmapIds: [],
  scoresDeleted: 0,
  beatmapsDeleted: 0,
  beatmapSetsDeleted: 0,
  kind: "incremental",
};

let db: Db;

beforeEach(() => {
  db = createAnalyticsTestDb();
});

afterEach(() => closeDb(db));

describe("needsFullRebuild", () => {
  test("a clean delta does not force a rebuild", () => {
    expect(needsFullRebuild(db, cleanDelta)).toBe(false);
  });

  test("a null delta forces a rebuild", () => {
    expect(needsFullRebuild(db, null)).toBe(true);
  });

  test("a PB on a failed play forces one rebuild", () => {
    seedBeatmap(db, "map-stale", CURVE);
    seedScore(db, {
      id: "stale-pb",
      beatmapId: "map-stale",
      playedAt: 1_000,
      accuracy: 1,
      pp: null,
      rank: -1,
    });
    db.insert(scoreMetrics)
      .values({
        scoreId: "stale-pb",
        retryIndex: 0,
        isPb: true,
        sessionId: null,
      })
      .run();

    expect(needsFullRebuild(db, cleanDelta)).toBe(true);
  });

  test("a PB on a graded play does not force a rebuild", () => {
    seedBeatmap(db, "map-ok", CURVE);
    seedScore(db, {
      id: "ok-pb",
      beatmapId: "map-ok",
      playedAt: 1_000,
      accuracy: 0.95,
      pp: 220,
      rank: 3,
    });
    db.insert(scoreMetrics)
      .values({
        scoreId: "ok-pb",
        retryIndex: 0,
        isPb: true,
        sessionId: null,
      })
      .run();

    expect(needsFullRebuild(db, cleanDelta)).toBe(false);
  });
});

describe("write-back import rows", () => {
  const insertWriteback = () => {
    const now = new Date("2026-03-05T00:00:00Z");
    db.insert(imports)
      .values({
        kind: "writeback",
        status: "success",
        startedAt: now,
        finishedAt: now,
        realmSchemaVersion: 1,
        changedScoreIds: JSON.stringify(["score-a"]),
        changedBeatmapIds: JSON.stringify(["map-a"]),
        watermarkPlayedAt: null,
        watermarkLastLocalUpdate: null,
      })
      .run();
  };

  test("a write-back row is a valid delta source", () => {
    insertWriteback();
    const delta = loadAnalyticsDelta(db);
    expect(delta?.kind).toBe("writeback");
    expect(delta?.scoreIds).toEqual(["score-a"]);
    expect(delta?.beatmapIds).toEqual(["map-a"]);
  });

  test("a write-back delta does not force a full rebuild", () => {
    insertWriteback();
    const delta = loadAnalyticsDelta(db);
    expect(needsFullRebuild(db, delta)).toBe(false);
  });

  test("a write-back row is ignored by the extraction gate", () => {
    insertWriteback();
    // With only a write-back row there is no extraction state to wait on, so
    // the gate and the watermark readers must not treat it as the latest cycle.
    expect(needsFullRebuild(db, cleanDelta)).toBe(false);
  });
});
