import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { beatmapSets, beatmaps, scores } from "@roxysu/db/schema";
import { bindDb } from "../db-runtime";
import {
  invalidatePlayerStatsCache,
  getCachedPlayerStats,
  playerStatsCacheKey,
} from "../analytics/playerStatsCache";
import {
  resolveScoresUsernamesSync,
  scoresUsernameCacheKey,
} from "../analytics/scoreUsername";
import {
  resolveScoresGamemodeSync,
  scoresGamemodeCacheKey,
} from "../analytics/scoreGamemode";
import { statsRoutes } from "./stats";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

const PLAYED_AT = Date.UTC(2026, 10, 20, 18, 0, 0);

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-stats-keycount-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(statsRoutes);
  invalidatePlayerStatsCache();

  db.insert(beatmapSets)
    .values({
      id: "set-a",
      onlineId: 9001,
      dateAdded: new Date(PLAYED_AT),
      status: 1,
    })
    .run();
  db.insert(beatmaps)
    .values([
      {
        id: "map-4k",
        onlineId: 5001,
        setId: "set-a",
        difficultyName: "4K",
        rulesetShortName: "mania",
        status: 1,
        length: 120_000,
        bpm: 180,
        starRating: 4,
        circleSize: 4,
        hidden: false,
      },
      {
        id: "map-7k",
        onlineId: 5002,
        setId: "set-a",
        difficultyName: "7K",
        rulesetShortName: "mania",
        status: 1,
        length: 120_000,
        bpm: 180,
        starRating: 5,
        circleSize: 7,
        hidden: false,
      },
    ])
    .run();

  // 4K is the player's preferred keymode (two plays vs one 7K play).
  const rows = [
    { id: "s-4k-1", beatmapId: "map-4k" },
    { id: "s-4k-2", beatmapId: "map-4k" },
    { id: "s-7k-1", beatmapId: "map-7k" },
  ];
  db.insert(scores)
    .values(
      rows.map((row, i) => ({
        ...row,
        onlineId: 100 + i,
        legacyOnlineId: 0,
        rulesetShortName: "mania",
        totalScore: 900_000,
        accuracy: 0.97,
        rank: 4,
        mods: "[]",
        playedAt: new Date(PLAYED_AT - i * 60_000),
        userUsername: "tester",
        deletePending: false,
      })),
    )
    .run();
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
  invalidatePlayerStatsCache();
});

async function getStats(query = "") {
  const res = await app.handle(
    new Request(`http://localhost/api/stats${query}`),
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe("GET /api/stats keymode resolution (UI-N2)", () => {
  test("an omitted keyCount resolves the preferred keymode and caches under it", async () => {
    const { status, body } = await getStats();
    expect(status).toBe(200);
    expect(body.preferredKeyCount).toBe(4);
    expect(body.keyCount).toBe(4);
    expect(body.availableKeyCounts).toContain(4);
    expect(body.availableKeyCounts).toContain(7);

    // The cache entry lives under the resolved key, not the 7K default.
    const resolvedKey = playerStatsCacheKey({
      granularity: "day",
      skillTopPlays: 30,
      keyCount: 4,
      username: scoresUsernameCacheKey(resolveScoresUsernamesSync(db)),
      gamemode: scoresGamemodeCacheKey(resolveScoresGamemodeSync(db)),
    });
    expect(getCachedPlayerStats(resolvedKey)).not.toBeNull();
    const sevenKey = playerStatsCacheKey({
      granularity: "day",
      skillTopPlays: 30,
      keyCount: 7,
      username: scoresUsernameCacheKey(resolveScoresUsernamesSync(db)),
      gamemode: scoresGamemodeCacheKey(resolveScoresGamemodeSync(db)),
    });
    expect(getCachedPlayerStats(sevenKey)).toBeNull();
  });

  test("an explicit keyCount is honored", async () => {
    const { body } = await getStats("?keyCount=7");
    expect(body.keyCount).toBe(7);
    expect(body.preferredKeyCount).toBe(4);
  });
});
