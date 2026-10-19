import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Db } from "../db-runtime";
import { resetHubSearchCircuit } from "./hubSearch";
import {
  collectMatchingOnlineBeatmapsets,
  parseOnlineMirrorQuery,
} from "./searchOnline";

const originalFetch = globalThis.fetch;
const originalProvider = process.env.BEATMAP_MIRROR_PROVIDER;

// excludeOwned=false never touches the database.
const db = {} as unknown as Db;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setsWithIds(ids: number[]) {
  return ids.map((id) => ({
    id,
    artist: "A",
    title: `T${id}`,
    creator: "C",
    status: "ranked",
    beatmaps: [],
  }));
}

type Calls = { hub: number; mirror: number };

function mockNetwork(opts: {
  hub: { ids: number[]; total: number; truncated: boolean };
  /** Mirror page index -> ids; unknown pages are empty. */
  mirrorPages: Record<number, number[]>;
  failMirror?: boolean;
}): Calls {
  const calls: Calls = { hub: 0, mirror: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === "hub.test") {
      calls.hub += 1;
      return json({
        cached: true,
        stale: false,
        total: opts.hub.total,
        truncated: opts.hub.truncated,
        beatmapsetIds: opts.hub.ids,
        beatmapsets: opts.hub.ids.map((id) => ({
          id,
          artist: "A",
          title: `T${id}`,
        })),
        label: "Ranked",
      });
    }
    calls.mirror += 1;
    if (opts.failMirror) return new Response("nope", { status: 503 });
    const page = Number(url.searchParams.get("page") ?? "0");
    return json(setsWithIds(opts.mirrorPages[page] ?? []));
  }) as unknown as typeof fetch;
  return calls;
}

const query = () =>
  parseOnlineMirrorQuery("mode=mania status=ranked", {
    defaultSort: "ranked_desc",
  });

beforeEach(() => {
  process.env.HUB_URL = "http://hub.test";
  process.env.BEATMAP_MIRROR_PROVIDER = "nerinyan";
  resetHubSearchCircuit();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HUB_URL;
  if (originalProvider === undefined) delete process.env.BEATMAP_MIRROR_PROVIDER;
  else process.env.BEATMAP_MIRROR_PROVIDER = originalProvider;
  resetHubSearchCircuit();
});

describe("collectMatchingOnlineBeatmapsets with a truncated Hub dump (F-025)", () => {
  test("continues the mirror crawl for the remainder and dedupes by set id", async () => {
    const calls = mockNetwork({
      hub: { ids: [1, 2, 3, 4, 5], total: 8, truncated: true },
      mirrorPages: { 0: [4, 5, 6, 7, 8] },
    });

    const result = await collectMatchingOnlineBeatmapsets(db, {
      onlineQuery: query(),
      excludeOwned: false,
      maxPages: 1000,
    });

    expect(calls.hub).toBe(1);
    expect(calls.mirror).toBeGreaterThan(0);
    expect(result.sets.map((s) => s.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.matched).toBe(8);
    expect(result.hitPageCap).toBe(false);
  });

  test("countOnly reports the full matched total without retaining sets", async () => {
    mockNetwork({
      hub: { ids: [1, 2, 3], total: 5, truncated: true },
      mirrorPages: { 0: [3, 4, 5] },
    });

    const result = await collectMatchingOnlineBeatmapsets(db, {
      onlineQuery: query(),
      excludeOwned: false,
      maxPages: 1000,
      countOnly: true,
    });

    expect(result.sets).toEqual([]);
    expect(result.matched).toBe(5);
    expect(result.hitPageCap).toBe(false);
  });

  test("flags the cap when the mirror crawl cannot cover the Hub total", async () => {
    mockNetwork({
      hub: { ids: [1, 2, 3], total: 10, truncated: true },
      mirrorPages: {},
      failMirror: true,
    });

    const result = await collectMatchingOnlineBeatmapsets(db, {
      onlineQuery: query(),
      excludeOwned: false,
      maxPages: 1000,
    });

    expect(result.matched).toBe(3);
    expect(result.hitPageCap).toBe(true);
  });

  test("a complete Hub dump never touches the mirrors", async () => {
    const calls = mockNetwork({
      hub: { ids: [1, 2, 3], total: 3, truncated: false },
      mirrorPages: { 0: [9] },
    });

    const result = await collectMatchingOnlineBeatmapsets(db, {
      onlineQuery: query(),
      excludeOwned: false,
      maxPages: 1000,
    });

    expect(calls.mirror).toBe(0);
    expect(result.matched).toBe(3);
    expect(result.hitPageCap).toBe(false);
  });

  test("a caller-imposed page cap stays an honest cap without a mirror crawl", async () => {
    const calls = mockNetwork({
      hub: { ids: [1, 2, 3], total: 500, truncated: true },
      mirrorPages: { 0: [9] },
    });

    const result = await collectMatchingOnlineBeatmapsets(db, {
      onlineQuery: query(),
      excludeOwned: false,
      maxPages: 2,
    });

    expect(calls.mirror).toBe(0);
    expect(result.matched).toBe(3);
    expect(result.hitPageCap).toBe(true);
  });
});
