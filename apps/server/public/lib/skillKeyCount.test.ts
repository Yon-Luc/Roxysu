import { describe, expect, test } from "bun:test";
import { normalizeSkillKeyCount, skillKeyCountFromSearch } from "./skillKeyCount";

describe("skillKeyCountFromSearch", () => {
  test("accepts mania key counts and rejects everything else", () => {
    expect(skillKeyCountFromSearch("4")).toBe(4);
    expect(skillKeyCountFromSearch(8.2)).toBe(8);
    expect(skillKeyCountFromSearch(undefined)).toBeNull();
    expect(skillKeyCountFromSearch("")).toBeNull();
    expect(skillKeyCountFromSearch(0)).toBeNull();
    expect(skillKeyCountFromSearch(19)).toBeNull();
    expect(normalizeSkillKeyCount(Number.NaN)).toBeNull();
  });
});
