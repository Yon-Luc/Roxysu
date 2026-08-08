import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, closeDb } from "@roxysu/db/client.bun";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { beatmapSets, beatmaps } from "@roxysu/db/schema";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countOwnedSetsMatchingMirrorParams,
  diffAgainstLibrary,
  diffBeatmapsetIds,
  loadOwnedSetOnlineIds,
  mirrorStatusToLocalInts,
} from "./ownership";
import type { Db } from "../db-runtime";
import { BEATMAP_STATUS } from "../query-language/status";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

let db: Db;

beforeAll(() => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });

  db.insert(beatmapSets)
    .values([
      {
        id: "set-owned-1",
        onlineId: 100,
        dateAdded: new Date(),
        status: 1,
        deletePending: false,
      },
      {
        id: "set-owned-2",
        onlineId: 200,
        dateAdded: new Date(),
        status: 1,
        deletePending: false,
      },
      // Pending deletion: should NOT count as owned.
      {
        id: "set-pending-delete",
        onlineId: 300,
        dateAdded: new Date(),
        status: 1,
        deletePending: true,
      },
      {
        id: "set-approved-osu",
        onlineId: 400,
        dateAdded: new Date(),
        status: BEATMAP_STATUS.approved,
        deletePending: false,
      },
      {
        id: "set-loved-mania",
        onlineId: 500,
        dateAdded: new Date(),
        status: BEATMAP_STATUS.loved,
        deletePending: false,
      },
      {
        id: "set-ranked-mania",
        onlineId: 600,
        dateAdded: new Date(),
        status: BEATMAP_STATUS.ranked,
        deletePending: false,
      },
    ])
    .run();

  db.insert(beatmaps)
    .values([
      {
        id: "bm-100",
        onlineId: 1001,
        setId: "set-owned-1",
        rulesetShortName: "osu",
        status: 1,
        length: 120,
        bpm: 180,
        starRating: 5.2,
        mapperUsername: "Alice",
      },
      {
        id: "bm-200",
        onlineId: 2001,
        setId: "set-owned-2",
        rulesetShortName: "osu",
        status: 1,
        length: 90,
        bpm: 140,
        starRating: 3.1,
        mapperUsername: "Bob",
      },
      {
        id: "bm-400",
        onlineId: 4001,
        setId: "set-approved-osu",
        rulesetShortName: "osu",
        status: 2,
        length: 100,
        bpm: 160,
        starRating: 4.0,
        mapperUsername: "Alice",
      },
      {
        id: "bm-500",
        onlineId: 5001,
        setId: "set-loved-mania",
        rulesetShortName: "mania",
        status: 4,
        length: 80,
        bpm: 170,
        starRating: 6.0,
        circleSize: 7,
        mapperUsername: "Carol",
      },
      {
        id: "bm-600",
        onlineId: 6001,
        setId: "set-ranked-mania",
        rulesetShortName: "mania",
        status: 1,
        length: 110,
        bpm: 150,
        starRating: 4.5,
        circleSize: 4,
        mapperUsername: "Dan",
      },
    ])
    .run();
});

afterAll(() => {
  closeDb(db);
});

describe("loadOwnedSetOnlineIds", () => {
  test("returns online ids not pending deletion", async () => {
    const owned = await loadOwnedSetOnlineIds(db);
    expect(owned.has(100)).toBe(true);
    expect(owned.has(200)).toBe(true);
    expect(owned.has(300)).toBe(false);
  });
});

describe("diffBeatmapsetIds", () => {
  test("splits candidates into owned / missing", () => {
    const owned = new Set([100, 200]);
    const result = diffBeatmapsetIds([100, 150, 200, 250], owned);
    expect(result.owned).toEqual([100, 200]);
    expect(result.missing).toEqual([150, 250]);
  });

  test("dedupes and ignores non-positive / non-integer ids", () => {
    const owned = new Set([100]);
    const result = diffBeatmapsetIds([100, 100, -5, 0, 150, 150], owned);
    expect(result.owned).toEqual([100]);
    expect(result.missing).toEqual([150]);
  });

  test("preserves the order candidates were given in", () => {
    const owned = new Set<number>();
    const result = diffBeatmapsetIds([3, 1, 2], owned);
    expect(result.missing).toEqual([3, 1, 2]);
  });
});

describe("diffAgainstLibrary", () => {
  test("loads owned ids from the db and diffs in one call", async () => {
    const result = await diffAgainstLibrary(db, [100, 300, 999]);
    // 300 is pending-delete, so it is NOT owned despite existing on disk.
    expect(result.owned).toEqual([100]);
    expect(result.missing).toEqual([300, 999]);
  });
});

describe("mirrorStatusToLocalInts", () => {
  test("ranked includes approved", () => {
    expect(mirrorStatusToLocalInts("ranked")).toEqual([
      BEATMAP_STATUS.ranked,
      BEATMAP_STATUS.approved,
    ]);
  });

  test("any / undefined means no filter", () => {
    expect(mirrorStatusToLocalInts("any")).toBeNull();
    expect(mirrorStatusToLocalInts(undefined)).toBeNull();
  });
});

describe("countOwnedSetsMatchingMirrorParams", () => {
  test("counts ranked+approved osu sets for mode:osu status=ranked", async () => {
    const count = await countOwnedSetsMatchingMirrorParams(db, {
      mode: "osu",
      status: "ranked",
    });
    // 100, 200 (ranked osu) + 400 (approved osu); not mania / loved / pending-delete
    expect(count).toBe(3);
  });

  test("counts loved mania only", async () => {
    const count = await countOwnedSetsMatchingMirrorParams(db, {
      mode: "mania",
      status: "loved",
    });
    expect(count).toBe(1);
  });

  test("applies star bounds on difficulties", async () => {
    const count = await countOwnedSetsMatchingMirrorParams(db, {
      mode: "osu",
      status: "ranked",
      minStars: 5,
    });
    expect(count).toBe(1); // only set 100 at 5.2★
  });
});
