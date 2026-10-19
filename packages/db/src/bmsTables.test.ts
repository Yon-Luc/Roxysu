import { describe, expect, test } from "bun:test";
import { loadBundledBmsTables } from "./bmsTables";

describe("loadBundledBmsTables", () => {
  test("loads Insane, Satellite, and Stella with their charts", () => {
    const tables = loadBundledBmsTables();
    expect(tables.map((table) => table.parsed.symbol)).toEqual(["★", "sl", "st"]);
    const insane = tables[0]!;
    expect(insane.parsed.name).toBe("発狂BMS難易度表");
    expect(insane.parsed.entries.length).toBeGreaterThan(1000);
    expect(insane.parsed.entries.some((entry) => entry.title?.includes("STAR OF ANDROMEDA"))).toBe(
      true,
    );
    expect(tables[1]?.parsed.entries.length).toBeGreaterThan(2000);
    expect(tables[2]?.parsed.entries.length).toBeGreaterThan(2000);
    expect(tables[1]?.parsed.levelOrder[0]).toBe("0");
  });
});
