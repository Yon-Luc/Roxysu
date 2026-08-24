import { describe, expect, test } from "bun:test";
import { compileQuery } from "./compile";
import { parseQuery } from "./parse";

describe("dan tier compile", () => {
  test("Regular 1 does not match Regular 10 labels", () => {
    const { sql, params } = compileQuery(parseQuery('dan:"Regular 1"'));
    expect(sql).toContain("dr.est_diff");
    expect(params).toEqual(expect.arrayContaining(["%Regular 1 %", "Regular 1"]));

    const matches = (label: string) => {
      const lower = label.toLowerCase();
      return lower.includes("regular 1 ") || lower === "regular 1";
    };

    expect(matches("Regular 1 mid")).toBe(true);
    expect(matches("Regular 10 mid")).toBe(false);
  });

  test("LN 1 does not match LN 10 labels", () => {
    const { params } = compileQuery(parseQuery('dan:"LN 1"'));
    expect(params).toEqual(expect.arrayContaining(["%LN 1 %", "LN 1"]));

    const matches = (label: string) => {
      const lower = label.toLowerCase();
      return lower.includes("ln 1 ") || lower === "ln 1";
    };

    expect(matches("LN 1 high")).toBe(true);
    expect(matches("LN 10 high")).toBe(false);
  });

  test("plain substring dan:Regular still matches both tiers", () => {
    const { params } = compileQuery(parseQuery("dan:Regular"));
    expect(params).toEqual(expect.arrayContaining(["%Regular%"]));
  });
});

describe("LIKE wildcard escaping", () => {
  test("mapper:% is a literal percent, not a wildcard", () => {
    const { params } = compileQuery(parseQuery("mapper:%"));
    expect(params).toContain("%\\%%");
  });

  test("bare text _ is escaped", () => {
    const { params } = compileQuery(parseQuery("_"));
    expect(params).toContain("%\\_%");
  });
});
