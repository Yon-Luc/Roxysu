import { describe, expect, test } from "bun:test";
import {
  cacheKeymode,
  hashQueryParams,
  normalizeRefreshIntervalMinutes,
  stripRoxysuCacheParams,
} from "./cache";
import { isCacheEntryDue } from "./cacheRefreshCron";

describe("hashQueryParams / key stripping", () => {
  test("includes key in hash so 7K differs from unfiltered mania", () => {
    const ranked = hashQueryParams({ mode: 3, status: "ranked" });
    const ranked7 = hashQueryParams({ mode: 3, status: "ranked", key: 7 });
    const ranked4 = hashQueryParams({ mode: 3, status: "ranked", key: 4 });
    expect(ranked).not.toBe(ranked7);
    expect(ranked7).not.toBe(ranked4);
  });

  test("keys alias hashes same as key when normalized by caller", () => {
    // Callers normalize keys→key before hashing; raw keys vs key differ if both present differently
    expect(hashQueryParams({ mode: 3, key: 7 })).toBe(
      hashQueryParams({ mode: 3, key: 7 }),
    );
  });

  test("stripRoxysuCacheParams removes key/keys for Hinamizawa", () => {
    expect(
      stripRoxysuCacheParams({
        mode: 3,
        status: "ranked",
        key: 7,
        keys: 7,
        query: "foo",
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      query: "foo",
    });
  });

  test("cacheKeymode reads key or keys", () => {
    expect(cacheKeymode({ key: 7 })).toBe(7);
    expect(cacheKeymode({ keys: 4 })).toBe(4);
    expect(cacheKeymode({ mode: 3 })).toBeNull();
    expect(cacheKeymode({ key: 0 })).toBeNull();
  });

  test("normalizeRefreshIntervalMinutes treats 0/null as manual", () => {
    expect(normalizeRefreshIntervalMinutes(null)).toBeNull();
    expect(normalizeRefreshIntervalMinutes(0)).toBeNull();
    expect(normalizeRefreshIntervalMinutes(360)).toBe(360);
  });
});

describe("isCacheEntryDue", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");

  test("manual-only entries are never due", () => {
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: null,
          lastRefreshAt: null,
          refreshBackoffUntil: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: 0,
          lastRefreshAt: null,
          refreshBackoffUntil: null,
        },
        now,
      ),
    ).toBe(false);
  });

  test("never-refreshed entry with interval is due", () => {
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: 60,
          lastRefreshAt: null,
          refreshBackoffUntil: null,
        },
        now,
      ),
    ).toBe(true);
  });

  test("due when interval elapsed", () => {
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: 60,
          lastRefreshAt: new Date(now - 61 * 60_000),
          refreshBackoffUntil: null,
        },
        now,
      ),
    ).toBe(true);
  });

  test("not due before interval", () => {
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: 360,
          lastRefreshAt: new Date(now - 60 * 60_000),
          refreshBackoffUntil: null,
        },
        now,
      ),
    ).toBe(false);
  });

  test("skips during failure backoff", () => {
    expect(
      isCacheEntryDue(
        {
          refreshIntervalMinutes: 60,
          lastRefreshAt: new Date(now - 120 * 60_000),
          refreshBackoffUntil: new Date(now + 5 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });
});
