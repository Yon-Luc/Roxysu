import { afterEach, describe, expect, test } from "bun:test";
import {
  mirrorParamsToHubQuery,
  tryFetchAllHubCachedIds,
  tryHubCachedSearch,
} from "./hubSearch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.HUB_URL;
  globalThis.fetch = originalFetch;
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

  test("omits sort so Download defaults still hit admin-primed caches", () => {
    expect(
      mirrorParamsToHubQuery({
        mode: "mania",
        status: "ranked",
        sort: "ranked_desc",
        key: 7,
      }),
    ).toEqual({
      mode: 3,
      status: "ranked",
      key: 7,
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
      label: "Ranked 7K",
    });
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
  test("paginates hub pages into one id list", async () => {
    process.env.HUB_URL = "http://hub.test";
    const pages = new Map<number, number[]>([
      [0, Array.from({ length: 100 }, (_, i) => i + 1)],
      [1, Array.from({ length: 50 }, (_, i) => i + 101)],
    ]);
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const page = Number(new URL(url).searchParams.get("page") ?? 0);
      const ids = pages.get(page) ?? [];
      return new Response(
        JSON.stringify({
          cached: true,
          stale: false,
          total: 150,
          page,
          limit: 100,
          beatmapsetIds: ids,
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
    expect(hit!.pagesFetched).toBe(2);
    expect(hit!.truncated).toBe(false);
    expect(requested.some((u) => u.includes("page=1"))).toBe(true);
  });

  test("returns null when a later page misses", async () => {
    process.env.HUB_URL = "http://hub.test";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input)).searchParams.get("page") ?? 0);
      if (page === 0) {
        return new Response(
          JSON.stringify({
            cached: true,
            total: 200,
            page: 0,
            limit: 100,
            beatmapsetIds: Array.from({ length: 100 }, (_, i) => i + 1),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ cached: false, beatmapsetIds: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    expect(
      await tryFetchAllHubCachedIds({
        mode: "mania",
        status: "ranked",
        key: 7,
      }),
    ).toBeNull();
  });
});
