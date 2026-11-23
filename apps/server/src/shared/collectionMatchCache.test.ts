import { describe, expect, test } from "bun:test";
import type { Db } from "@roxysu/db/types";

import {
  scheduleRefreshAllMatchCounts,
  startCollectionMatchCache,
  stopCollectionMatchCache,
} from "./collectionMatchCache";

type FakeDb = { db: Db; refreshes: () => number };

/**
 * Minimal chainable stand-in: `hasUncachedCollections` gets no rows (so startup
 * does not schedule) and the refresh query returns no collections.
 */
function fakeDb(): FakeDb {
  let refreshes = 0;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    from: self,
    where: self,
    limit: self,
    get: () => undefined,
    all: () => {
      refreshes += 1;
      return [];
    },
  });
  return { db: chain as unknown as Db, refreshes: () => refreshes };
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("collection match cache lifecycle", () => {
  test("stop is idempotent and suppresses later scheduled refreshes", async () => {
    const { db, refreshes } = fakeDb();
    const stop = startCollectionMatchCache(db);

    scheduleRefreshAllMatchCounts(db);
    await drain();
    expect(refreshes()).toBe(1);

    stop();
    stop(); // idempotent

    scheduleRefreshAllMatchCounts(db);
    await drain();
    expect(refreshes()).toBe(1);
  });

  test("module-level stop also prevents scheduled refreshes", async () => {
    const { db, refreshes } = fakeDb();
    startCollectionMatchCache(db);
    stopCollectionMatchCache();
    stopCollectionMatchCache();

    scheduleRefreshAllMatchCounts(db);
    await drain();
    expect(refreshes()).toBe(0);
  });
});
