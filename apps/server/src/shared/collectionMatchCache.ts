/**
 * Lazy match-count cache for smart collections.
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

let _refreshPending = false;

/** Coalesce rapid refresh requests into one background run. */
export function scheduleRefreshAllMatchCounts(db: Db): void {
  if (_refreshPending) return;
  _refreshPending = true;
  setImmediate(() => {
    _refreshPending = false;
    try {
      refreshAllCollectionMatchCounts(db);
    } catch (err) {
      console.error("[collectionMatchCache] refresh error", err);
    }
  });
}

export function refreshAllCollectionMatchCounts(db: Db): void {
  const rows = db
    .select({ id: collections.id, query: collections.query })
    .from(collections)
    .all();
  if (rows.length === 0) return;
  const ctx = buildQueryContext(db);
  for (const col of rows) {
    try {
      const count = countMatchesPure(db, col.query, ctx);
      db.update(collections)
        .set({ cachedMatchCount: count })
        .where(eq(collections.id, col.id))
        .run();
    } catch {
      // skip invalid queries silently
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
