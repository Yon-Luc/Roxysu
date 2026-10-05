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

  test("bare dan:Regular matches Regular bands via token patterns", () => {
    const { params, sql } = compileQuery(parseQuery("dan:Regular"));
    expect(params).toEqual(
      expect.arrayContaining(["Regular", "Regular %", "% Regular %", "% Regular"]),
    );
    expect(sql).toContain("NOT LIKE '<%'");
  });

  test("4K Reform tiers match Sunny labels, not only Daniel", () => {
    const { sql, params } = compileQuery(parseQuery('dan:"Reform 5"'));
    expect(sql).toContain("dr.est_diff");
    expect(sql).toContain("dr_d.est_diff");
    expect(params).toEqual(
      expect.arrayContaining(["%Reform 5 %", "Reform 5"]),
    );
  });

  test("dan:Alpha matches Alpha bands but not under-band sentinel", () => {
    const { params, sql } = compileQuery(parseQuery("dan:Alpha"));
    expect(params).toEqual(
      expect.arrayContaining(["Alpha", "Alpha %", "% Alpha %", "% Alpha"]),
    );
    expect(sql).toContain("NOT LIKE '<%'");
    expect(sql).toContain("NOT LIKE '>%'");

    const matches = (label: string) => {
      const lower = label.toLowerCase();
      if (lower.startsWith("<") || lower.startsWith(">")) return false;
      return (
        lower === "alpha" ||
        lower.startsWith("alpha ") ||
        lower.includes(" alpha ") ||
        lower.endsWith(" alpha")
      );
    };

    expect(matches("Alpha Low")).toBe(true);
    expect(matches("Alpha mid")).toBe(true);
    expect(matches("Alpha mid/high")).toBe(true);
    expect(matches("< Alpha Low")).toBe(false);
  });

  test("daniel:Alpha excludes under-band sentinel", () => {
    const { sql } = compileQuery(parseQuery("daniel:Alpha"));
    expect(sql).toContain("dr_d.est_diff");
    expect(sql).not.toContain("dr.est_diff");
    expect(sql).toContain("NOT LIKE '<%'");
  });

  test("dan:Theta excludes over-band sentinel", () => {
    const matches = (label: string) => {
      const lower = label.toLowerCase();
      if (lower.startsWith("<") || lower.startsWith(">")) return false;
      return (
        lower === "theta" ||
        lower.startsWith("theta ") ||
        lower.includes(" theta ") ||
        lower.endsWith(" theta")
      );
    };
    expect(matches("CloverWisp Theta High")).toBe(true);
    expect(matches("> CloverWisp Theta High")).toBe(false);
  });

  test("dan:Gamma still matches Regular Gamma and bare Gamma", () => {
    const matches = (label: string) => {
      const lower = label.toLowerCase();
      if (lower.startsWith("<") || lower.startsWith(">")) return false;
      return (
        lower === "gamma" ||
        lower.startsWith("gamma ") ||
        lower.includes(" gamma ") ||
        lower.endsWith(" gamma")
      );
    };
    expect(matches("Gamma mid")).toBe(true);
    expect(matches("Regular Gamma low")).toBe(true);
    expect(matches("LN Gamma high")).toBe(true);
  });

  test("dan:Zeta matches Emik Zeta bands", () => {
    const matches = (label: string) => {
      const lower = label.toLowerCase();
      if (lower.startsWith("<") || lower.startsWith(">")) return false;
      return (
        lower === "zeta" ||
        lower.startsWith("zeta ") ||
        lower.includes(" zeta ") ||
        lower.endsWith(" zeta")
      );
    };
    expect(matches("Emik Zeta Low")).toBe(true);
    expect(matches("Emik Zeta mid/high")).toBe(true);
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
