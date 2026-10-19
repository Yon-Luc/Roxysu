import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, closeDb } from "@roxysu/db/client.bun";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { beatmapSets } from "@roxysu/db/schema";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OWNED_SET_IDS_MAX_LIMIT,
  loadOwnedSetIdsVersion,
  loadOwnedSetOnlineIdsPage,
} from "./ownership";
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
  const rows = [10, 20, 30, 40, 50].map((onlineId) => ({
    id: `set-${onlineId}`,
    onlineId,
    dateAdded: new Date(),
    status: 1,
    deletePending: false,
  }));
  db.insert(beatmapSets)
    .values([
      ...rows,
      // Excluded: pending deletion and non-online (onlineId <= 0).
      {
        id: "set-pending",
        onlineId: 35,
        dateAdded: new Date(),
        status: 1,
        deletePending: true,
      },
      {
        id: "set-offline",
        onlineId: 0,
        dateAdded: new Date(),
        status: 1,
        deletePending: false,
      },
    ])
    .run();
});

afterAll(() => {
  closeDb(db);
});

async function walk(limit: number): Promise<{ pages: number[][]; all: number[] }> {
  const pages: number[][] = [];
  let after = 0;
  for (;;) {
    const page = await loadOwnedSetOnlineIdsPage(db, { after, limit });
    pages.push(page.setIds);
    if (page.nextAfter == null) break;
    after = page.nextAfter;
  }
  return { pages, all: pages.flat() };
}

describe("loadOwnedSetOnlineIdsPage", () => {
  test("pages ascending ids, excluding pending-delete and non-online sets", async () => {
    const { pages, all } = await walk(2);
    expect(pages).toEqual([[10, 20], [30, 40], [50]]);
    expect(all).toEqual([10, 20, 30, 40, 50]);
  });

  test("exact-multiple boundary yields no trailing empty page", async () => {
    const { pages } = await walk(5);
    expect(pages).toEqual([[10, 20, 30, 40, 50]]);
    const first = await loadOwnedSetOnlineIdsPage(db, { limit: 5 });
    expect(first.nextAfter).toBeNull();
  });

  test("limit of one walks every id and the cursor is the last id returned", async () => {
    const first = await loadOwnedSetOnlineIdsPage(db, { limit: 1 });
    expect(first).toEqual({ setIds: [10], nextAfter: 10 });
    const { all } = await walk(1);
    expect(all).toEqual([10, 20, 30, 40, 50]);
  });

  test("after past the last id returns an empty final page", async () => {
    const page = await loadOwnedSetOnlineIdsPage(db, { after: 50, limit: 10 });
    expect(page).toEqual({ setIds: [], nextAfter: null });
  });

  test("clamps oversize and non-positive limits", async () => {
    const big = await loadOwnedSetOnlineIdsPage(db, {
      limit: OWNED_SET_IDS_MAX_LIMIT * 10,
    });
    expect(big.setIds).toHaveLength(5);
    const zero = await loadOwnedSetOnlineIdsPage(db, { limit: 0 });
    expect(zero.setIds).toEqual([10]);
  });
});

describe("loadOwnedSetIdsVersion", () => {
  test("is stable until the owned id set changes", async () => {
    const a = await loadOwnedSetIdsVersion(db);
    expect(await loadOwnedSetIdsVersion(db)).toBe(a);
    db.insert(beatmapSets)
      .values({
        id: "set-new",
        onlineId: 60,
        dateAdded: new Date(),
        status: 1,
        deletePending: false,
      })
      .run();
    const b = await loadOwnedSetIdsVersion(db);
    expect(b).not.toBe(a);
  });
});
