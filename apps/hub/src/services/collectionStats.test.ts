import { describe, expect, test } from "bun:test";
import { aggregateCollectionStats } from "./collectionStats";
import { hubModeTagForRuleset, parseHubSearchQuery } from "./hubSearchQuery";

describe("aggregateCollectionStats", () => {
  test("picks mania + dominant keys and star range", () => {
    const stats = aggregateCollectionStats([
      { mode: "mania", stars: 4.2, keys: 7 },
      { mode: "mania", stars: 6.1, keys: 7 },
      { mode: "mania", stars: 5.0, keys: 4 },
      { mode: "osu", stars: 3.0, keys: null },
    ]);
    expect(stats.dominantMode).toBe("mania");
    expect(stats.dominantKeys).toBe(7);
    expect(stats.starsMin).toBe(4.2);
    expect(stats.starsMax).toBe(6.1);
  });

  test("a tied mode count keeps the first mode and ignores the other star range", () => {
    const stats = aggregateCollectionStats([
      { mode: "mania", stars: 5, keys: 7 },
      { mode: "osu", stars: 6, keys: null },
    ]);
    expect(stats.dominantMode).toBe("mania");
    expect(stats.dominantKeys).toBe(7);
    expect(stats.starsMin).toBe(5);
    expect(stats.starsMax).toBe(5);
  });
});

describe("computeCollectionStatsFromSetIds deadline", () => {
  test("returns when the deadline fires instead of waiting out every fetch", async () => {
    const { computeCollectionStatsFromSetIds } = await import("./collectionStats");
    const started = Date.now();
    const stats = await computeCollectionStatsFromSetIds(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      undefined,
      {
        deadlineMs: 40,
        fetchImpl: (_url, init) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(new Response("{}", { status: 200 })),
              5_000,
            );
            init.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(stats.dominantMode).toBeNull();
    expect(stats.starsMin).toBeNull();
  });
});

describe("parseHubSearchQuery", () => {
  test("extracts mode/key/stars and leaves free text", () => {
    const q = parseHubSearchQuery("mode=m key=7 stars>=5 jump pack");
    expect(q.mode).toBe("mania");
    expect(q.keys).toBe(7);
    expect(q.starsMin).toBe(5);
    expect(q.text).toBe("jump pack");
  });

  test("key alone implies mania", () => {
    const q = parseHubSearchQuery("keys=4");
    expect(q.mode).toBe("mania");
    expect(q.keys).toBe(4);
  });
});

describe("hubModeTagForRuleset", () => {
  test("maps osu/fruits to std/ctb tags", () => {
    expect(hubModeTagForRuleset("osu")).toBe("std");
    expect(hubModeTagForRuleset("fruits")).toBe("ctb");
    expect(hubModeTagForRuleset("taiko")).toBe("taiko");
    expect(hubModeTagForRuleset("mania")).toBe("mania");
  });
});
