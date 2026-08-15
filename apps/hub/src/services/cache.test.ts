import { describe, expect, test } from "bun:test";
import {
  baseParamsFromCacheQuery,
  cacheKeymode,
  filterStubs,
  hashQueryParams,
  normalizeRefreshIntervalMinutes,
  parseStoredStubs,
  secondaryFiltersFromQuery,
  stripRoxysuCacheParams,
  type HubSearchStub,
} from "./cache";
import { isCacheEntryDue } from "./cacheRefreshCron";

describe("hashQueryParams / base identity", () => {
  test("includes key in hash so 7K differs from unfiltered mania", () => {
    const ranked = hashQueryParams({ mode: 3, status: "ranked" });
    const ranked7 = hashQueryParams({ mode: 3, status: "ranked", key: 7 });
    const ranked4 = hashQueryParams({ mode: 3, status: "ranked", key: 4 });
    expect(ranked).not.toBe(ranked7);
    expect(ranked7).not.toBe(ranked4);
  });

  test("keys alias hashes the same as key", () => {
    expect(hashQueryParams({ mode: 3, keys: 7 })).toBe(
      hashQueryParams({ mode: 3, key: 7 }),
    );
  });

  test("secondary filters do not change base hash", () => {
    const base = hashQueryParams({
      mode: 3,
      status: "ranked",
      key: 7,
      sort: "ranked_desc",
    });
    const withStars = hashQueryParams({
      mode: 3,
      status: "ranked",
      key: 7,
      sort: "ranked_desc",
      min_stars: 5,
      query: "foo",
      creator: "bar",
    });
    expect(withStars).toBe(base);
  });

  test("uses a 32-char SHA-256 prefix, not 8-char FNV", () => {
    const h = hashQueryParams({ mode: 3, status: "ranked" });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toHaveLength(8);
  });

  test("stripRoxysuCacheParams removes key/keys and secondary for Hinamizawa", () => {
    expect(
      stripRoxysuCacheParams({
        mode: 3,
        status: "ranked",
        key: 7,
        keys: 7,
        sort: "ranked_desc",
        query: "foo",
        min_stars: 5,
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      sort: "ranked_desc",
    });
  });

  test("baseParamsFromCacheQuery keeps only identity fields", () => {
    expect(
      baseParamsFromCacheQuery({
        mode: 3,
        status: "ranked",
        key: 7,
        sort: "ranked_desc",
        min_stars: 5,
        query: "x",
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      key: 7,
      sort: "ranked_desc",
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

describe("parseStoredStubs / filterStubs", () => {
  const stub = (partial: Partial<HubSearchStub> & { id: number }): HubSearchStub => ({
    artist: "",
    title: `Beatmapset ${partial.id}`,
    creator: "",
    status: "ranked",
    bpm: null,
    favouriteCount: 0,
    playCount: 0,
    hasVideo: false,
    rankedDate: null,
    lengthSeconds: null,
    beatmaps: [],
    ...partial,
  });

  test("dual-reads legacy number[]", () => {
    expect(parseStoredStubs("[1,2,3]").map((s) => s.id)).toEqual([1, 2, 3]);
  });

  test("reads enriched stubs", () => {
    const parsed = parseStoredStubs(
      JSON.stringify([
        {
          id: 9,
          artist: "A",
          title: "T",
          creator: "C",
          bpm: 160,
          beatmaps: [{ id: 1, stars: 5, modeInt: 3, keys: 7, version: "x", mode: "mania", totalLength: 90 }],
        },
      ]),
    );
    expect(parsed[0]!.title).toBe("T");
    expect(parsed[0]!.beatmaps[0]!.stars).toBe(5);
  });

  test("filters by stars, bpm, query, creator", () => {
    const stubs = [
      stub({
        id: 1,
        artist: "Foo",
        title: "Bar",
        creator: "Alice",
        bpm: 180,
        lengthSeconds: 100,
        beatmaps: [
          {
            id: 11,
            version: "7K",
            stars: 5.5,
            mode: "mania",
            modeInt: 3,
            keys: 7,
            totalLength: 100,
          },
        ],
      }),
      stub({
        id: 2,
        artist: "Other",
        title: "Song",
        creator: "Bob",
        bpm: 120,
        lengthSeconds: 50,
        beatmaps: [
          {
            id: 22,
            version: "7K",
            stars: 3,
            mode: "mania",
            modeInt: 3,
            keys: 7,
            totalLength: 50,
          },
        ],
      }),
    ];
    expect(filterStubs(stubs, { min_stars: 5 }).map((s) => s.id)).toEqual([1]);
    expect(filterStubs(stubs, { min_bpm: 150 }).map((s) => s.id)).toEqual([1]);
    expect(filterStubs(stubs, { query: "foo" }).map((s) => s.id)).toEqual([1]);
    expect(filterStubs(stubs, { creator: "bob" }).map((s) => s.id)).toEqual([
      2,
    ]);
    expect(secondaryFiltersFromQuery({ min_stars: 5, query: "x" })).toEqual({
      min_stars: 5,
      query: "x",
    });
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
