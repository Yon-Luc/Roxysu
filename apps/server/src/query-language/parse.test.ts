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
});
