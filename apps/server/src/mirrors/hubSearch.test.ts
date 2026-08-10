import { afterEach, describe, expect, test } from "bun:test";
import { mirrorParamsToHubQuery, tryHubCachedSearch } from "./hubSearch";

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
});
