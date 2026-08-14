import { describe, expect, it } from "bun:test";
import { generateSessionName } from "./generate";

describe("generateSessionName", () => {
  it("is deterministic for the same session id", () => {
    expect(generateSessionName(42)).toBe(generateSessionName(42));
    expect(generateSessionName(1)).toBe(generateSessionName(1));
  });

  it("produces different names for different ids", () => {
    const names = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => generateSessionName(id)),
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("returns a non-empty string", () => {
    for (const id of [1, 7, 99, 1000]) {
      const name = generateSessionName(id);
      expect(name.length).toBeGreaterThan(3);
      expect(name.trim()).toBe(name);
    }
  });

  it("always capitalizes the first letter", () => {
    for (let id = 1; id <= 200; id++) {
      const name = generateSessionName(id);
      const first = name[0]!;
      expect(first).toBe(first.toUpperCase());
    }
  });

  it("avoids names already in the taken set", () => {
    const first = generateSessionName(7);
    const second = generateSessionName(7, [first]);
    expect(second).not.toBe(first);
    expect(generateSessionName(7, [first])).toBe(second);
  });

  it("assigns unique names when accumulating taken names", () => {
    const taken: string[] = [];
    for (let id = 1; id <= 2000; id++) {
      const name = generateSessionName(id, taken);
      expect(taken.map((n) => n.toLowerCase())).not.toContain(name.toLowerCase());
      taken.push(name);
    }
    expect(new Set(taken.map((n) => n.toLowerCase())).size).toBe(2000);
  });
});
