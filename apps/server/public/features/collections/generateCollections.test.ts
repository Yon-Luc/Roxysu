import { describe, expect, test } from "bun:test";
import { reworkDanBaseTierNames } from "@roxysu/mania-difficulty";
import { parseQuery } from "@server/query-language";
import {
  buildAccuracyCollections,
  buildDanCollections,
  buildStarCollections,
  hasDistinctLnTable,
} from "./generateCollections";

function queriesOf(
  built: ReturnType<typeof buildStarCollections>,
): string[] {
  if (!built.ok) throw new Error(built.reason);
  return built.items.map((item) => item.query);
}

describe("buildStarCollections", () => {
  test("splits 1 to 10 into half-open buckets and includes 10", () => {
    const built = buildStarCollections({
      keyCount: 7,
      min: 1,
      max: 10,
      step: 1,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.items).toHaveLength(9);
    expect(built.items[0]).toEqual({
      name: "7K rework 1-2",
      query: "key:7 reworkstars:>=1 reworkstars:<2",
    });
    expect(built.items[1]?.query).toBe("key:7 reworkstars:>=2 reworkstars:<3");
    expect(built.items[8]).toEqual({
      name: "7K rework 9-10",
      query: "key:7 reworkstars:>=9 reworkstars:<=10",
    });
    for (const query of queriesOf(built)) parseQuery(query);
  });

  test("appends an extra fragment", () => {
    const built = buildStarCollections({
      keyCount: 4,
      min: 1,
      max: 2,
      step: 1,
      extra: " ranked ",
    });
    expect(built).toEqual({
      ok: true,
      items: [
        {
          name: "4K rework 1-2",
          query: "key:4 reworkstars:>=1 reworkstars:<=2 ranked",
        },
      ],
    });
  });

  test("rejects a step that would exceed the batch cap", () => {
    expect(
      buildStarCollections({ keyCount: 7, min: 0, max: 10, step: 0.01 }),
    ).toEqual({ ok: false, reason: "too-many" });
  });

  test("rejects an empty or backwards range", () => {
    expect(
      buildStarCollections({ keyCount: 7, min: 10, max: 1, step: 1 }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      buildStarCollections({ keyCount: 7, min: 1, max: 10, step: 0 }),
    ).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("buildAccuracyCollections", () => {
  test("keeps the boundary in the next band and closes the last one", () => {
    const built = buildAccuracyCollections({
      keyCount: 7,
      bands: "90-93, 93-95, 95-97",
    });
    expect(built).toEqual({
      ok: true,
      items: [
        { name: "7K acc 90-93", query: "key:7 acc:>=90 acc:<93" },
        { name: "7K acc 93-95", query: "key:7 acc:>=93 acc:<95" },
        { name: "7K acc 95-97", query: "key:7 acc:>=95 acc:<=97" },
      ],
    });
    for (const query of queriesOf(built)) parseQuery(query);
  });

  test("a single band includes both ends", () => {
    expect(
      buildAccuracyCollections({ keyCount: 7, bands: "90-93" }).ok &&
        buildAccuracyCollections({ keyCount: 7, bands: "90-93" }),
    ).toEqual({
      ok: true,
      items: [{ name: "7K acc 90-93", query: "key:7 acc:>=90 acc:<=93" }],
    });
  });

  test("rejects bands outside 0-100", () => {
    expect(
      buildAccuracyCollections({ keyCount: 7, bands: "90-101" }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(buildAccuracyCollections({ keyCount: 7, bands: "nope" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("buildDanCollections", () => {
  test("one collection per base tier, not each sub-level", () => {
    const tiers = reworkDanBaseTierNames(7, "rice");
    expect(tiers).toContain("Regular 10");
    expect(tiers).not.toContain("Regular 10+");
    const built = buildDanCollections({
      keyCount: 7,
      tiers: ["Regular 10", "Regular >∞"],
    });
    expect(built).toEqual({
      ok: true,
      items: [
        { name: "7K Regular 10", query: 'key:7 dan:"Regular 10"' },
        { name: "7K Regular >∞", query: 'key:7 dan:"Regular >∞"' },
      ],
    });
    for (const query of queriesOf(built)) parseQuery(query);
  });

  test("4K has its own LN table; 7K does not", () => {
    expect(hasDistinctLnTable(4)).toBe(true);
    expect(hasDistinctLnTable(7)).toBe(false);
    const built = buildDanCollections({ keyCount: 4, tiers: ["LN 13"] });
    expect(built).toEqual({
      ok: true,
      items: [{ name: "4K LN 13", query: 'key:4 dan:"LN 13"' }],
    });
  });
});
