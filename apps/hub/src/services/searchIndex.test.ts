import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "@roxysu/db/hub";
import { searchCache } from "@roxysu/db/hub";
import { filterStubs, type HubSearchStub } from "./cache";
import {
  escapeLikePattern,
  querySearchIndexAll,
  querySearchIndexPage,
  replaceSetsForCache,
} from "./searchIndex";

function stub(
  partial: Partial<HubSearchStub> & { id: number },
): HubSearchStub {
  return {
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
  };
}

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE search_cache (
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
    CREATE TABLE search_index_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      cache_id INTEGER NOT NULL,
      beatmapset_id INTEGER NOT NULL,
      artist TEXT DEFAULT '' NOT NULL,
      title TEXT DEFAULT '' NOT NULL,
      creator TEXT DEFAULT '' NOT NULL,
      status TEXT DEFAULT '' NOT NULL,
      bpm REAL,
      favourite_count INTEGER DEFAULT 0 NOT NULL,
      play_count INTEGER DEFAULT 0 NOT NULL,
      has_video INTEGER DEFAULT false NOT NULL,
      ranked_date TEXT,
      length_seconds INTEGER,
      position INTEGER NOT NULL,
      FOREIGN KEY (cache_id) REFERENCES search_cache(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX search_index_sets_cache_set_unique
      ON search_index_sets (cache_id, beatmapset_id);
    CREATE TABLE search_index_diffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      set_row_id INTEGER NOT NULL,
      beatmap_id INTEGER NOT NULL,
      version TEXT DEFAULT 'Unknown' NOT NULL,
      stars REAL DEFAULT 0 NOT NULL,
      mode TEXT DEFAULT 'osu' NOT NULL,
      mode_int INTEGER DEFAULT 0 NOT NULL,
      keys INTEGER,
      total_length INTEGER,
      FOREIGN KEY (set_row_id) REFERENCES search_index_sets(id) ON DELETE cascade
    );
  `);
  return drizzle(sqlite, { schema });
}

const fixtures: HubSearchStub[] = [
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
  stub({
    id: 3,
    artist: "Wide",
    title: "Range",
    creator: "Cara",
    bpm: 140,
    lengthSeconds: 80,
    beatmaps: [
      {
        id: 31,
        version: "easy",
        stars: 3,
        mode: "mania",
        modeInt: 3,
        keys: 7,
        totalLength: 80,
      },
      {
        id: 32,
        version: "hard",
        stars: 7,
        mode: "mania",
        modeInt: 3,
        keys: 7,
        totalLength: 80,
      },
    ],
  }),
];

describe("escapeLikePattern", () => {
  test("escapes LIKE wildcards", () => {
    expect(escapeLikePattern("100%_fun\\x")).toBe("100\\%\\_fun\\\\x");
  });
});

describe("search index SQL filters", () => {
  let testdb: ReturnType<typeof openTestDb>;

  afterEach(() => {
    testdb = undefined as unknown as ReturnType<typeof openTestDb>;
  });

  async function seed() {
    testdb = openTestDb();
    const row = await testdb
      .insert(searchCache)
      .values({
        queryHash: "abc",
        queryParams: "{}",
        beatmapsetIds: "[]",
        totalCount: fixtures.length,
      })
      .returning({ id: searchCache.id })
      .get();
    await replaceSetsForCache(testdb, row.id, fixtures);
    return row.id;
  }

  test("matches filterStubs for stars / bpm / query / creator", async () => {
    const cacheId = await seed();
    const cases = [
      { min_stars: 5 },
      { min_bpm: 150 },
      { query: "foo" },
      { creator: "bob" },
      { min_stars: 5, max_stars: 6 },
      { min_length: 90 },
    ] as const;

    for (const secondary of cases) {
      const sqlIds = (
        await querySearchIndexPage(testdb, cacheId, secondary, 0, 100)
      ).ids;
      const memIds = filterStubs(fixtures, secondary).map((s) => s.id);
      expect(sqlIds).toEqual(memIds);
    }
  });

  test("star filter is any-diff-in-range, not set min/max overlap", async () => {
    const cacheId = await seed();
    const page = await querySearchIndexPage(
      testdb,
      cacheId,
      { min_stars: 5, max_stars: 6 },
      0,
      100,
    );
    expect(page.ids).toEqual([1]);
  });

  test("paginates by stored position", async () => {
    const cacheId = await seed();
    const first = await querySearchIndexPage(testdb, cacheId, {}, 0, 2);
    const second = await querySearchIndexPage(testdb, cacheId, {}, 1, 2);
    expect(first.total).toBe(3);
    expect(first.ids).toEqual([1, 2]);
    expect(second.ids).toEqual([3]);
    expect(first.stubs[0]!.beatmaps[0]!.stars).toBe(5.5);
  });

  test("dump compact returns artist/title for every match", async () => {
    const cacheId = await seed();
    const dump = await querySearchIndexAll(testdb, cacheId, { query: "foo" }, {
      fields: "compact",
    });
    expect(dump.total).toBe(1);
    expect(dump.truncated).toBe(false);
    expect(dump.sets).toEqual([{ id: 1, artist: "Foo", title: "Bar" }]);
  });

  test("LIKE wildcards in the query are literal", async () => {
    const cacheId = await seed();
    const dump = await querySearchIndexAll(testdb, cacheId, { query: "Foo%" });
    expect(dump.beatmapsetIds).toEqual([]);
  });

  test("replaceSetsForCache overwrites previous rows", async () => {
    const cacheId = await seed();
    await replaceSetsForCache(testdb, cacheId, [fixtures[1]!]);
    const page = await querySearchIndexPage(testdb, cacheId, {}, 0, 100);
    expect(page.ids).toEqual([2]);
    expect(page.total).toBe(1);
  });
});
