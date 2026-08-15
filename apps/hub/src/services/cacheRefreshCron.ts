import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "@roxysu/db/hub";
import { refreshCache } from "./cache";

const FAILURE_BACKOFF_MS = 15 * 60 * 1000;

let tickRunning = false;

function asDate(value: Date | number | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

/** Entries whose refresh interval has elapsed (and not in failure backoff). */
export function isCacheEntryDue(
  row: {
    refreshIntervalMinutes: number | null;
    lastRefreshAt: Date | number | null;
    refreshBackoffUntil: Date | number | null;
  },
  nowMs = Date.now(),
): boolean {
  const interval = row.refreshIntervalMinutes;
  if (interval == null || interval <= 0) return false;

  const backoff = asDate(row.refreshBackoffUntil);
  if (backoff && backoff.getTime() > nowMs) return false;

  const last = asDate(row.lastRefreshAt);
  if (!last) return true;
  return nowMs - last.getTime() >= interval * 60_000;
}

/**
 * Minute-tick worker: refresh at most one due search_cache row.
 * Single-flight so overlapping cron fires / long primes do not stack.
 */
export async function tickSearchCacheRefreshes(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const rows = await db
      .select({
        id: searchCache.id,
        label: searchCache.label,
        queryHash: searchCache.queryHash,
        totalCount: searchCache.totalCount,
        refreshIntervalMinutes: searchCache.refreshIntervalMinutes,
        lastRefreshAt: searchCache.lastRefreshAt,
        refreshBackoffUntil: searchCache.refreshBackoffUntil,
      })
      .from(searchCache)
      .where(
        and(
          isNotNull(searchCache.refreshIntervalMinutes),
          gt(searchCache.refreshIntervalMinutes, 0),
        ),
      );

    const due = rows.find((row) => isCacheEntryDue(row));
    if (!due) return;

    console.log(
      `[cache-cron] Refreshing "${due.label || due.queryHash}" (id=${due.id})`,
    );
    const beforeCount = due.totalCount;
    try {
      await refreshCache(due.id);
      const updated = await db
        .select({ totalCount: searchCache.totalCount })
        .from(searchCache)
        .where(eq(searchCache.id, due.id))
        .get();
      const after = updated?.totalCount ?? 0;
      console.log(
        `[cache-cron] refreshed "${due.label || due.queryHash}" (id=${due.id}, ${beforeCount}→${after} ids)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cache-cron] refresh failed id=${due.id}:`, message);
      await db
        .update(searchCache)
        .set({
          refreshError: message.slice(0, 500),
          refreshBackoffUntil: new Date(Date.now() + FAILURE_BACKOFF_MS),
        })
        .where(eq(searchCache.id, due.id));
    }
  } finally {
    tickRunning = false;
  }
}
