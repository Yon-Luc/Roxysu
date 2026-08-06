import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, closeDb } from "@roxysu/db/client.bun";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { beatmapSets } from "@roxysu/db/schema";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diffAgainstLibrary, diffBeatmapsetIds, loadOwnedSetOnlineIds } from "./ownership";
import type { Db } from "../db-runtime";

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
