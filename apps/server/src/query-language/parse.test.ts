import { describe, expect, test } from "bun:test";
import { parseQuery, looksLikeQuery } from "./parse";
import { compileQuery } from "./compile";
import { QueryParseError } from "./ast";

describe("looksLikeQuery", () => {
  test("detects field queries", () => {
    expect(looksLikeQuery("mode:mania")).toBe(true);
    expect(looksLikeQuery("stars:5..6")).toBe(true);
    expect(looksLikeQuery("acc>98")).toBe(true);
    expect(looksLikeQuery("key=7")).toBe(true);
    expect(looksLikeQuery("ln<10")).toBe(true);
    expect(looksLikeQuery("sunny>7")).toBe(true);
    expect(looksLikeQuery("pattern:jack")).toBe(true);
    expect(looksLikeQuery("hello world")).toBe(false);
  });
});

describe("parseQuery", () => {
  test("parses architecture examples", () => {
    expect(parseQuery("mode:mania")).toEqual({
      type: "term",
      term: { type: "mode", value: "mania" },
    });
    expect(parseQuery("mapper:Lasse")).toEqual({
      type: "term",
      term: { type: "mapper", value: "Lasse" },
    });
    expect(parseQuery("stars:5..6")).toEqual({
      type: "term",
      term: { type: "stars", min: 5, max: 6 },
    });
    expect(parseQuery("mods:DT")).toEqual({
      type: "term",
      term: { type: "mods", value: "DT" },
    });
    expect(parseQuery("acc>98")).toEqual({
      type: "term",
      term: { type: "acc", op: ">", value: 98 },
    });
    expect(parseQuery("retry>10")).toEqual({
      type: "term",
      term: { type: "retry", op: ">", value: 10 },
    });
    expect(parseQuery("mastery>80")).toEqual({
      type: "term",
      term: { type: "mastery", op: ">", value: 80 },
    });
    expect(parseQuery("played:last30d")).toEqual({
      type: "term",
      term: { type: "played", days: 30 },
    });
    expect(parseQuery("title:^SL_5")).toEqual({
      type: "term",
      term: { type: "title", value: "SL_5", prefix: true },
    });
    expect(parseQuery("key=7")).toEqual({
      type: "term",
      term: { type: "key", op: "=", value: 7 },
    });
    expect(parseQuery("keys:4..7")).toEqual({
      type: "term",
      term: { type: "key", min: 4, max: 7 },
    });
    expect(parseQuery("ln<10")).toEqual({
      type: "term",
      term: { type: "ln", op: "<", value: 10 },
    });
    expect(parseQuery("lns:0..20")).toEqual({
      type: "term",
      term: { type: "ln", min: 0, max: 20 },
    });
    expect(parseQuery("dan:Reform")).toEqual({
      type: "term",
      term: { type: "dan", value: "Reform", prefix: false },
    });
    expect(parseQuery("dan:^Alpha")).toEqual({
      type: "term",
      term: { type: "dan", value: "Alpha", prefix: true },
    });
    expect(parseQuery('dan:"Regular 4"')).toEqual({
      type: "term",
      term: { type: "dan", value: "Regular 4", prefix: false },
    });
    expect(parseQuery("sunny:5..6")).toEqual({
      type: "term",
      term: { type: "sunny", min: 5, max: 6 },
    });
    expect(parseQuery("sunny>7")).toEqual({
      type: "term",
      term: { type: "sunny", op: ">", value: 7 },
    });
    expect(parseQuery("danstars>=8")).toEqual({
      type: "term",
      term: { type: "sunny", op: ">=", value: 8 },
    });
    expect(parseQuery("pattern:jack")).toEqual({
      type: "term",
      term: { type: "pattern", value: "jack", prefix: false },
    });
    expect(parseQuery("dominant:jumpstream")).toEqual({
      type: "term",
      term: { type: "pattern", value: "jumpstream", prefix: false },
    });
    expect(parseQuery("style:chordjack")).toEqual({
      type: "term",
      term: { type: "pattern", value: "chordjack", prefix: false },
    });
    expect(parseQuery("pattern:^bracket")).toEqual({
      type: "term",
      term: { type: "pattern", value: "bracket", prefix: true },
    });
    expect(parseQuery("axis:rc")).toEqual({
      type: "term",
      term: { type: "axis", value: "rc" },
    });
    expect(parseQuery("rice:ln")).toEqual({
      type: "term",
      term: { type: "axis", value: "ln" },
    });
  });

  test("boolean AND OR NOT and parens", () => {
    const ast = parseQuery("mode:mania AND stars:5..6 OR NOT mapper:foo");
    expect(ast.type).toBe("or");
    if (ast.type !== "or") return;
    expect(ast.left.type).toBe("and");
    expect(ast.right.type).toBe("not");

    const grouped = parseQuery("(mode:osu OR mode:mania) stars:6..7");
    expect(grouped.type).toBe("and");
  });

  test("juxtaposition is AND", () => {
    const ast = parseQuery("mode:mania stars:5..6");
    expect(ast).toEqual({
      type: "and",
      left: { type: "term", term: { type: "mode", value: "mania" } },
      right: { type: "term", term: { type: "stars", min: 5, max: 6 } },
    });
  });

  test("rejects unknown fields", () => {
    expect(() => parseQuery("foo:bar")).toThrow(QueryParseError);
  });
});

describe("compileQuery", () => {
  test("compiles mode + stars range", () => {
    const ast = parseQuery("mode:mania stars:5..6");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("ruleset_short_name");
    expect(compiled.sql).toContain("BETWEEN");
    expect(compiled.params).toEqual(["mania", 5, 6]);
  });

  test("compiles mastery and acc comparisons", () => {
    const ast = parseQuery("mastery>80 acc>98");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("m.level");
    expect(compiled.sql).toContain("best_accuracy");
    expect(compiled.params).toEqual([80, 0.98]);
  });

  test("compiles key filter as mania + circle size", () => {
    const ast = parseQuery("key=7");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("ruleset_short_name");
    expect(compiled.sql).toContain("circle_size");
    expect(compiled.params).toEqual(["mania", 7]);
  });

  test("compiles ln filter as mania + end-time object %", () => {
    const ast = parseQuery("ln<10");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("ruleset_short_name");
    expect(compiled.sql).toContain("end_time_object_count");
    expect(compiled.sql).toContain("total_object_count");
    expect(compiled.params).toEqual(["mania", 10]);
  });

  test("compiles dan label substring against sunny ratings", () => {
    const ast = parseQuery("dan:Reform");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr.est_diff");
    expect(compiled.sql).toContain("LIKE");
    expect(compiled.params).toEqual(["%Reform%"]);
  });

  test("compiles sunny star range", () => {
    const ast = parseQuery("sunny:5..6");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr.sunny_star");
    expect(compiled.sql).toContain("BETWEEN");
    expect(compiled.params).toEqual([5, 6]);
  });

  test("compiles pattern label against pattern analysis", () => {
    const ast = parseQuery("pattern:jumpstream");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("pa.dominant_pattern");
    expect(compiled.sql).toContain("pa.secondary_pattern");
    expect(compiled.params).toEqual(["%jumpstream%", "%jumpstream%"]);
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
  });

  test("compiles combined key and pattern with matching bind count", () => {
    const ast = parseQuery("key=7 pattern:chordstream");
    const compiled = compileQuery(ast);
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
    expect(compiled.params).toEqual(["mania", 7, "%chordstream%", "%chordstream%"]);
  });

  test("compiles axis rc against sunny ln_ratio", () => {
    const ast = parseQuery("key=7 axis:rc pattern:jack");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr.ln_ratio");
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
    expect(compiled.params).toEqual(["mania", 7, 0.2, "%jack%", "%jack%"]);
  });

  test("compiles axis ln against sunny ln_ratio", () => {
    const ast = parseQuery("axis:ln");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr.ln_ratio >=");
    expect(compiled.params).toEqual([0.2]);
  });


  test("compiles NOT played:lastNd with correct parentheses", () => {
    const ast = parseQuery("acc:90..93 NOT played:last14d");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("NOT (ps.last_played_at IS NOT NULL AND");
  });
});
