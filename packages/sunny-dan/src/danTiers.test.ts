import { describe, expect, test } from "bun:test";
import {
  danQueryForTier,
  danTierFromLabel,
  danTiersForKeyCount,
} from "./danTiers";

describe("danTiersForKeyCount", () => {
  test("7K RC includes Regular 9 and Regular Gamma", () => {
    const tiers = danTiersForKeyCount(7, "RC");
    expect(tiers).toContain("Regular 9");
    expect(tiers).toContain("Regular Gamma");
    expect(tiers.indexOf("Regular 9")).toBeLessThan(
      tiers.indexOf("Regular Gamma"),
    );
  });

  test("4K RC includes Reform 9 and Gamma", () => {
    const tiers = danTiersForKeyCount(4, "RC");
    expect(tiers).toContain("Reform 9");
    expect(tiers).toContain("Gamma");
  });
});

describe("danTierFromLabel", () => {
  test("strips band suffixes", () => {
    expect(danTierFromLabel("Regular 9 mid/high")).toBe("Regular 9");
    expect(danTierFromLabel("Gamma low")).toBe("Gamma");
  });
});

describe("danQueryForTier", () => {
  test("quotes the dan field", () => {
    expect(danQueryForTier("Regular 9")).toBe('dan:"Regular 9"');
  });
});
