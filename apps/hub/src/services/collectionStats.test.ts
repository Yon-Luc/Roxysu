import { describe, expect, test } from "bun:test";
import { aggregateCollectionStats } from "./collectionStats";
import { parseHubSearchQuery } from "./hubSearchQuery";

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
    expect(stats.starsMin).toBe(3.0);
    expect(stats.starsMax).toBe(6.1);
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
