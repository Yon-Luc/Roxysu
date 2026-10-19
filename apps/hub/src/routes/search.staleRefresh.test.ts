import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { searchCache } from "@roxysu/db/hub";

describe("maybeRefreshStale backoff", () => {
  let maybeRefreshStale: typeof import("./search").maybeRefreshStale;
  let refreshCacheSingleFlight: typeof import("../services/cache").refreshCacheSingleFlight;
  let recordRefreshFailure: typeof import("../services/cache").recordRefreshFailure;
  let REFRESH_FAILURE_BACKOFF_MS: number;
  let db: typeof import("../db").db;

  beforeAll(async () => {
    process.env.DATABASE_URL = ":memory:";
    ({ maybeRefreshStale } = await import("./search"));
    ({
      refreshCacheSingleFlight,
      recordRefreshFailure,
      REFRESH_FAILURE_BACKOFF_MS,
    } = await import("../services/cache"));
    ({ db } = await import("../db"));
    db.$client.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL UNIQUE,
        query_params TEXT NOT NULL,
        beatmapset_ids TEXT NOT NULL DEFAULT '[]',
        total_count INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL DEFAULT '',
        refresh_interval_minutes INTEGER,
        last_refresh_at INTEGER,
        refresh_error TEXT,
        refresh_backoff_until INTEGER,
        cached_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  });

  test("stale row inside refresh backoff does not start a crawl", () => {
    const id = 880_001;
    void maybeRefreshStale(
      { id, refreshBackoffUntil: new Date(Date.now() + 60_000) },
      "hit-stale",
      "203.0.113.21",
    );
    expect(refreshCacheSingleFlight.has(id)).toBe(false);
  });

  test("stale row past refresh backoff starts a crawl", async () => {
    const id = 880_002;
    void maybeRefreshStale(
      { id, refreshBackoffUntil: new Date(Date.now() - 1_000) },
      "hit-stale",
      "203.0.113.22",
    );
    expect(refreshCacheSingleFlight.has(id)).toBe(true);
    await refreshCacheSingleFlight(id).catch(() => undefined);
    expect(refreshCacheSingleFlight.has(id)).toBe(false);
  });

  test("a rejected refresh writes a 15 minute backoff and a truncated error", async () => {
    const inserted = await db
      .insert(searchCache)
      .values({
        queryHash: "backoff-test",
        queryParams: "{}",
        cachedAt: new Date(),
      })
      .returning({ id: searchCache.id })
      .get();
    const id = inserted!.id;
    const before = Date.now();
    await recordRefreshFailure(id, new Error("x".repeat(600)));
    const row = await db
      .select({
        refreshError: searchCache.refreshError,
        refreshBackoffUntil: searchCache.refreshBackoffUntil,
      })
      .from(searchCache)
      .where(eq(searchCache.id, id))
      .get();
    expect(row?.refreshError).toBe("x".repeat(500));
    const until = row?.refreshBackoffUntil?.getTime() ?? 0;
    expect(until - before).toBeGreaterThanOrEqual(REFRESH_FAILURE_BACKOFF_MS - 2_000);
    expect(until - before).toBeLessThanOrEqual(REFRESH_FAILURE_BACKOFF_MS + 2_000);
  });
});
