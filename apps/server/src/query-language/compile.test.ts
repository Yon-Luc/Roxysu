import { describe, expect, test } from "bun:test";
import { compileQuery } from "./compile";
import { parseQuery } from "./parse";

describe("dan tier compile", () => {
  test("Regular 1 expands to Regular 1 / 1+ / 1++ without Regular 10", () => {
    const { sql, params } = compileQuery(parseQuery('dan:"Regular 1"'));
    expect(sql).toContain("dr_r.est_diff");
    expect(params).toEqual([
      "Regular 1",
      "Regular 1 %",
      "Regular 1+",
      "Regular 1+ %",
      "Regular 1++",
      "Regular 1++ %",
    ]);
    expect(params).not.toContain("Regular 10");
    expect(params).not.toContain("Regular 10 %");
  });

  test("LN 1 falls back to tier-safe label matching", () => {
    const { params, sql } = compileQuery(parseQuery('dan:"LN 1"'));
    expect(sql).toContain("dr_r.est_diff");
    expect(params).toEqual(["%LN 1 %", "LN 1"]);
  });

  test("bare dan:Regular falls back to token patterns", () => {
    const { params, sql } = compileQuery(parseQuery("dan:Regular"));
    expect(sql).toContain("dr_r.est_diff");
    expect(params).toEqual([
      "Regular",
      "Regular %",
      "% Regular %",
      "% Regular",
    ]);
    expect(sql).toContain("NOT LIKE '<%'");
  });

  test("dan:Alpha matches only the rework label column", () => {
    const { sql, params } = compileQuery(parseQuery("dan:Alpha"));
    expect(sql).toContain("dr_r.est_diff");
    expect(sql).not.toContain("dr.est_diff");
    expect(sql).not.toContain("dr_d.est_diff");
    expect(params).toEqual(["α", "α %"]);
  });

  test("dan:Gamma spans every γ sub-level like rework:", () => {
    const { sql, params } = compileQuery(parseQuery("dan:Gamma"));
    expect(sql).toContain("dr_r.est_diff");
    expect(sql).toContain("OR");
    for (const expected of [
      "γ",
      "γ %",
      "Regular γ--",
      "Regular γ-- %",
      "Regular γ++",
      "Regular γ++ %",
    ]) {
      expect(params).toContain(expected);
    }
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

describe("axis thresholds", () => {
  test("axis:ln uses [ln, fln) bounds on rework ln_ratio", () => {
    const { sql, params } = compileQuery(parseQuery("axis:ln"), {
      axisThresholds: { ln: 0.25, fln: 0.7 },
    });
    expect(sql).toContain("dr_r.ln_ratio >=");
    expect(sql).toContain("dr_r.ln_ratio <");
    expect(params).toEqual([0.25, 0.7]);
  });

  test("axis:fln and axis:rc use custom bounds", () => {
    const fln = compileQuery(parseQuery("axis:fln"), {
      axisThresholds: { ln: 0.1, fln: 0.55 },
    });
    const rc = compileQuery(parseQuery("axis:rc"), {
      axisThresholds: { ln: 0.1, fln: 0.55 },
    });
    expect(fln.params).toEqual([0.55]);
    expect(rc.params).toEqual([0.1]);
  });
});

describe("rework dan fields", () => {
  test("rework:Alpha matches only the rework label column", () => {
    const { sql, params } = compileQuery(parseQuery("rework:Alpha"));
    expect(sql).toContain("dr_r.est_diff");
    expect(sql).not.toContain("dr_d.est_diff");
    // "Alpha" resolves to the 4K α group (one member: exact-or-prefix match).
    expect(params).toEqual(["α", "α %"]);
  });

  test("rework:Gamma spans every γ sub-level on both key modes", () => {
    const { sql, params } = compileQuery(parseQuery("rework:Gamma"));
    expect(sql).toContain("dr_r.est_diff");
    expect(sql).toContain("OR");
    for (const expected of [
      "γ",
      "γ %",
      "Regular γ--",
      "Regular γ-- %",
      "Regular γ++",
      "Regular γ++ %",
    ]) {
      expect(params).toContain(expected);
    }
  });

  test("rework:γ matches the glyph spelling too", () => {
    const { params } = compileQuery(parseQuery("rework:γ"));
    expect(params).toContain("Regular γ--");
    expect(params).toContain("Regular γ-- %");
  });

  test("rework:Zeta matches the ζ group", () => {
    const { params } = compileQuery(parseQuery("rework:Zeta"));
    expect(params).toEqual(["ζ", "ζ %"]);
  });

  test("rework:LN 14 keeps the tier-number guard", () => {
    const { sql, params } = compileQuery(parseQuery('rework:"LN 14"'));
    expect(sql).toContain("dr_r.est_diff");
    expect(params).toEqual(["LN 14", "LN 14 %"]);
  });

  test("unresolvable rework tokens fall back to generic label matching", () => {
    const { params, sql } = compileQuery(parseQuery("rework:zzzz"));
    expect(sql).toContain("NOT LIKE '<%'");
    expect(params).toEqual(["zzzz", "zzzz %", "% zzzz %", "% zzzz"]);
  });

  test("rework:^Reg is a prefix match", () => {
    const { params } = compileQuery(parseQuery("rework:^Reg"));
    expect(params).toEqual(["Reg%"]);
  });

  test("rework: excludes out-of-band sentinels unless asked for", () => {
    const { params } = compileQuery(parseQuery("rework:>Eta"));
    expect(params[0]).toBe(">Eta");
  });

  test("reworkstars accepts a range and a comparison", () => {
    const range = compileQuery(parseQuery("reworkstars:6.5..8"));
    expect(range.sql).toContain("dr_r.sunny_star BETWEEN");
    expect(range.params).toEqual([6.5, 8]);

    const cmp = compileQuery(parseQuery("reworkstars:>=10"));
    expect(cmp.sql).toContain("dr_r.sunny_star >=");
    expect(cmp.params).toEqual([10]);
  });

  test("rework fields never read sunny or daniel algorithm joins", () => {
    for (const query of ["rework:Eta", "reworkstars:5..6", "dan:Alpha"]) {
      const { sql } = compileQuery(parseQuery(query));
      expect(sql).not.toContain("dr.sunny_star");
      expect(sql).not.toContain("dr_d.sunny_star");
      expect(sql).not.toContain("dr.est_diff");
      expect(sql).not.toContain("dr_d.est_diff");
    }
  });

  test("dan: compiles like rework:", () => {
    const dan = compileQuery(parseQuery("dan:Alpha"));
    const rework = compileQuery(parseQuery("rework:Alpha"));
    expect(dan.sql).toBe(rework.sql);
    expect(dan.params).toEqual(rework.params);
  });
});
