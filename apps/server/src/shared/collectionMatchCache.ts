/**
 * Lazy match-count store for smart collections.
 *
 * GET /collections reads `cached_match_count` from the DB row instead of
 * running countMatches per collection. Counts refresh on create/update and
 * in the background after sync/mastery events.
 */
import type { Db } from "@roxysu/db/types";
import { collections } from "@roxysu/db/schema";
import { eq, isNull } from "drizzle-orm";
import { buildQueryContext, countMatchesPure } from "../query-language/execute";
import { subscribe } from "./events";
import { invalidateCollectionMd5Cache } from "./syncCollections";

const YIELD_EVERY = 1;

export function refreshCollectionMatchCount(db: Db, id: number): void {
  const [col] = db
    .select({ id: collections.id, query: collections.query })
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1)
    .all();
  if (!col) return;

  try {
    const ctx = buildQueryContext(db);
    const count = countMatchesPure(db, col.query, ctx);
    db.update(collections)
      .set({ cachedMatchCount: count })
      .where(eq(collections.id, id))
      .run();
  } catch {
    // Ignore parse errors — leave cachedMatchCount as-is (null shown as "—").
  }
}

let _refreshRunning = false;
let _refreshQueued = false;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Coalesce rapid refresh requests into one background run. */
export function scheduleRefreshAllMatchCounts(db: Db): void {
  if (_refreshRunning) {
    _refreshQueued = true;
    return;
  }
  if (_refreshQueued && !_refreshRunning) {
    return;
  }
  _refreshRunning = true;
  void runRefreshAllMatchCounts(db);
}

async function runRefreshAllMatchCounts(db: Db): Promise<void> {
  try {
    await refreshAllCollectionMatchCounts(db);
  } catch (err) {
    console.error("[collectionMatchCache] refresh error", err);
  } finally {
    _refreshRunning = false;
    if (_refreshQueued) {
      _refreshQueued = false;
      scheduleRefreshAllMatchCounts(db);
    }
  }
}

export async function refreshAllCollectionMatchCounts(db: Db): Promise<void> {
  const rows = db
    .select({ id: collections.id, query: collections.query })
    .from(collections)
    .all();
  if (rows.length === 0) return;
  const ctx = buildQueryContext(db);
  for (let i = 0; i < rows.length; i += 1) {
    const col = rows[i]!;
    try {
      const count = countMatchesPure(db, col.query, ctx);
      db.update(collections)
        .set({ cachedMatchCount: count })
        .where(eq(collections.id, col.id))
        .run();
    } catch {
      // skip invalid queries silently
    }
    if ((i + 1) % YIELD_EVERY === 0 && i + 1 < rows.length) {
      await yieldToEventLoop();
    }
  }
}

function hasUncachedCollections(db: Db): boolean {
  const row = db
    .select({ id: collections.id })
    .from(collections)
    .where(isNull(collections.cachedMatchCount))
    .limit(1)
    .get();
  return row != null;
}

/** Wire event listeners and backfill any missing cached counts on startup. */
export function startCollectionMatchCache(db: Db): void {
  subscribe((event) => {
    if (event.type === "sync.finished") {
      invalidateCollectionMd5Cache();
      scheduleRefreshAllMatchCounts(db);
      return;
    }
    if (event.type === "mastery.updated") {
      scheduleRefreshAllMatchCounts(db);
    }
  });

  if (hasUncachedCollections(db)) {
    scheduleRefreshAllMatchCounts(db);
  }
}

export function readCachedMatchCount(db: Db, id: number): number | null {
  const [fresh] = db
    .select({ n: collections.cachedMatchCount })
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1)
    .all();
  return fresh?.n ?? null;
}
