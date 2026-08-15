import { afterEach, describe, expect, test } from "bun:test";
import {
  isHubSearchCircuitOpen,
  mirrorParamsToHubQuery,
  resetHubSearchCircuit,
  tryFetchAllHubCachedIds,
  tryHubCachedSearch,
} from "./hubSearch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.HUB_URL;
  globalThis.fetch = originalFetch;
  resetHubSearchCircuit();
});

describe("mirrorParamsToHubQuery", () => {
  test("includes mania key for hub cache identity", () => {
    expect(
      mirrorParamsToHubQuery({
        mode: "mania",
        status: "ranked",
        key: 7,
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      key: 7,
    });
  });

  test("forwards sort so Recently ranked matches admin primes", () => {
    expect(
      mirrorParamsToHubQuery({
        mode: "mania",
        status: "ranked",
        sort: "ranked_desc",
        key: 7,
        minStars: 5,
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      sort: "ranked_desc",
      key: 7,
      min_stars: 5,
    });
  });
});

describe("tryHubCachedSearch", () => {
  test("requests hub with key=7 and returns HIT when cached", async () => {
    process.env.HUB_URL = "http://hub.test";
    let requested: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          cached: true,
          stale: false,
          total: 2,
          page: 0,
          limit: 100,
          beatmapsetIds: [101, 202],
          label: "Ranked 7K",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const hit = await tryHubCachedSearch({
      mode: "mania",
      status: "ranked",
      key: 7,
      page: 0,
      limit: 100,
    });

    expect(requested!).toContain("key=7");
    expect(requested!).toContain("mode=3");
    expect(requested!).toContain("status=ranked");
    expect(hit).toEqual({
      cached: true,
      stale: false,
      total: 2,
      page: 0,
      limit: 100,
      beatmapsetIds: [101, 202],
      beatmapsets: [],
      label: "Ranked 7K",
    });
  });

  test("prefers enriched beatmapsets from hub", async () => {
    process.env.HUB_URL = "http://hub.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          cached: true,
          stale: false,
          total: 1,
          page: 0,
          limit: 100,
          beatmapsetIds: [101],
          beatmapsets: [
            {
              id: 101,
              artist: "A",
              title: "Song",
              creator: "M",
              bpm: 160,
              beatmaps: [
                {
                  id: 1,
                  stars: 5,
                  modeInt: 3,
                  keys: 7,
                  version: "7K",
                  mode: "mania",
                  totalLength: 90,
                },
              ],
            },
          ],
          label: "Ranked 7K",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const hit = await tryHubCachedSearch({
      mode: "mania",
      status: "ranked",
      key: 7,
      minStars: 4,
    });
    expect(hit!.beatmapsets).toHaveLength(1);
    expect(hit!.beatmapsets[0]!.title).toBe("Song");
  });

  test("returns null on cache miss", async () => {
    process.env.HUB_URL = "http://hub.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          cached: false,
          beatmapsetIds: [1],
          total: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const hit = await tryHubCachedSearch({
      mode: "mania",
      status: "ranked",
      key: 7,
    });
    expect(hit).toBeNull();
  });

  test("uses localhost:4322 when HUB_URL is unset", async () => {
    delete process.env.HUB_URL;
    let requested: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(JSON.stringify({ cached: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await tryHubCachedSearch({ mode: "mania", status: "ranked" });
    expect(requested!).toContain("http://localhost:4322/search");
  });
});

describe("tryFetchAllHubCachedIds", () => {
  test("loads the hub dump in one request", async () => {
    process.env.HUB_URL = "http://hub.test";
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const ids = Array.from({ length: 150 }, (_, i) => i + 1);
      return new Response(
        JSON.stringify({
          cached: true,
          stale: false,
          total: 150,
          truncated: false,
          beatmapsetIds: ids,
          beatmapsets: ids.map((id) => ({
            id,
            artist: "A",
            title: `T${id}`,
          })),
          label: "Ranked 7K",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const hit = await tryFetchAllHubCachedIds({
      mode: "mania",
      status: "ranked",
      key: 7,
    });

    expect(hit).not.toBeNull();
    expect(hit!.total).toBe(150);
    expect(hit!.beatmapsetIds).toHaveLength(150);
    expect(hit!.beatmapsetIds[0]).toBe(1);
    expect(hit!.beatmapsetIds[149]).toBe(150);
    expect(hit!.sets[0]!.title).toBe("T1");
    expect(hit!.pagesFetched).toBe(1);
    expect(hit!.truncated).toBe(false);
    expect(requested).toHaveLength(1);
    expect(requested[0]!).toContain("/search/all");
    expect(requested[0]!).toContain("fields=compact");
  });

  test("returns null when the dump misses", async () => {
    process.env.HUB_URL = "http://hub.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ cached: false, beatmapsetIds: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    expect(
      await tryFetchAllHubCachedIds({
        mode: "mania",
        status: "ranked",
        key: 7,
      }),
    ).toBeNull();
  });
});

describe("hub search circuit", () => {
  test("opens after a network failure and skips the next lookup", async () => {
    process.env.HUB_URL = "http://hub.test";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;

    expect(
      await tryHubCachedSearch({ mode: "mania", status: "ranked", key: 7 }),
    ).toBeNull();
    expect(isHubSearchCircuitOpen()).toBe(true);
    expect(
      await tryHubCachedSearch({ mode: "mania", status: "ranked", key: 7 }),
    ).toBeNull();
    expect(calls).toBe(1);
  });
});
