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
    expect(looksLikeQuery("reworkstars>7")).toBe(true);
    expect(looksLikeQuery("ar>9")).toBe(true);
    expect(looksLikeQuery("cs=4")).toBe(true);
    expect(looksLikeQuery("od>=8")).toBe(true);
    expect(looksLikeQuery("hp<6")).toBe(true);
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
    expect(parseQuery("reworkstars:5..6")).toEqual({
      type: "term",
      term: { type: "reworkstars", min: 5, max: 6 },
    });
    expect(parseQuery("reworkstars>7")).toEqual({
      type: "term",
      term: { type: "reworkstars", op: ">", value: 7 },
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
    expect(parseQuery("pattern:release")).toEqual({
      type: "term",
      term: { type: "pattern", value: "release", prefix: false },
    });
    expect(parseQuery("axis:rc")).toEqual({
      type: "term",
      term: { type: "axis", value: "rc" },
    });
    expect(parseQuery("rice:ln")).toEqual({
      type: "term",
      term: { type: "axis", value: "ln" },
    });
    expect(parseQuery("status:ranked")).toEqual({
      type: "term",
      term: { type: "status", values: ["ranked"] },
    });
    expect(parseQuery("status:ranked,loved")).toEqual({
      type: "term",
      term: { type: "status", values: ["ranked", "loved"] },
    });
    expect(parseQuery("ranked")).toEqual({
      type: "term",
      term: { type: "status", values: ["ranked"] },
    });
    expect(parseQuery("status=r")).toEqual({
      type: "term",
      term: { type: "status", values: ["ranked"] },
    });
    expect(parseQuery("status=pending")).toEqual({
      type: "term",
      term: { type: "status", values: ["pending"] },
    });
    expect(parseQuery("status=ranking")).toEqual({
      type: "term",
      term: { type: "status", values: ["ranked"] },
    });
    expect(parseQuery("mode=m")).toEqual({
      type: "term",
      term: { type: "mode", value: "m" },
    });
    expect(parseQuery("mode=mania")).toEqual({
      type: "term",
      term: { type: "mode", value: "mania" },
    });
    expect(parseQuery("mode=m status=r")).toEqual({
      type: "and",
      left: { type: "term", term: { type: "mode", value: "m" } },
      right: { type: "term", term: { type: "status", values: ["ranked"] } },
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

    const withStatus = parseQuery("mode:mania key=7 ranked");
    expect(withStatus).toEqual({
      type: "and",
      left: {
        type: "and",
        left: { type: "term", term: { type: "mode", value: "mania" } },
        right: { type: "term", term: { type: "key", op: "=", value: 7 } },
      },
      right: { type: "term", term: { type: "status", values: ["ranked"] } },
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

  test("compiles catch and ctb as fruits", () => {
    for (const query of ["mode:ctb", "mode:catch", "mode=CTB", "mode:fruits"]) {
      const compiled = compileQuery(parseQuery(query));
      expect(compiled.sql).toContain("b.ruleset_short_name = ?");
      expect(compiled.params).toEqual(["fruits"]);
    }
  });

  test("compiles mastery and acc comparisons", () => {
    const ast = parseQuery("mastery>80 acc>98");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("m.level");
    expect(compiled.sql).toContain("best_accuracy");
    expect(compiled.params).toEqual([80, 0.98]);
  });

  test("parses approach rate, circle size, overall difficulty, and HP drain", () => {
    expect(parseQuery("ar>=9")).toEqual({
      type: "term",
      term: { type: "ar", op: ">=", value: 9 },
    });
    expect(parseQuery("cs:4..4.5")).toEqual({
      type: "term",
      term: { type: "cs", min: 4, max: 4.5 },
    });
    expect(parseQuery("od:8")).toEqual({
      type: "term",
      term: { type: "od", min: 8, max: 8 },
    });
    expect(parseQuery("hp<6")).toEqual({
      type: "term",
      term: { type: "hp", op: "<", value: 6 },
    });
    expect(parseQuery("approachrate=9.2 circlesize>4 overalldifficulty<=8 drainrate:5")).toEqual({
      type: "and",
      left: {
        type: "and",
        left: {
          type: "and",
          left: { type: "term", term: { type: "ar", op: "=", value: 9.2 } },
          right: { type: "term", term: { type: "cs", op: ">", value: 4 } },
        },
        right: { type: "term", term: { type: "od", op: "<=", value: 8 } },
      },
      right: { type: "term", term: { type: "hp", min: 5, max: 5 } },
    });
  });

  test("keeps pattern:cs as chordstream, not circle size", () => {
    expect(parseQuery("pattern:cs")).toEqual({
      type: "term",
      term: { type: "pattern", value: "chordstream", prefix: false },
    });
  });

  test("compiles difficulty stats against beatmap columns", () => {
    const compiled = compileQuery(parseQuery("ar>=9 cs=4 od:8..9 hp<6"));
    expect(compiled.sql).toContain("b.approach_rate");
    expect(compiled.sql).toContain("b.circle_size");
    expect(compiled.sql).toContain("b.overall_difficulty");
    expect(compiled.sql).toContain("b.drain_rate");
    expect(compiled.sql).not.toContain("ruleset_short_name");
    expect(compiled.params).toEqual([9, 4, 8, 9, 6]);
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

  test("compiles dan label match against rework ratings", () => {
    const ast = parseQuery("dan:Alpha");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr_r.est_diff");
    expect(compiled.sql).not.toContain("dr.est_diff");
    expect(compiled.sql).not.toContain("dr_d.est_diff");
    expect(compiled.params).toEqual(["α", "α %"]);
  });

  test("rejects removed sunny and daniel fields", () => {
    expect(() => parseQuery("sunny:5..6")).toThrow(QueryParseError);
    expect(() => parseQuery("daniel:Alpha")).toThrow(QueryParseError);
    expect(() => parseQuery("danstars:8")).toThrow(QueryParseError);
    expect(() => parseQuery("sunnystars:7")).toThrow(QueryParseError);
  });

  test("compiles reworkstars range", () => {
    const ast = parseQuery("reworkstars:5..6");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr_r.sunny_star");
    expect(compiled.sql).toContain("BETWEEN");
    expect(compiled.params).toEqual([5, 6]);
  });

  test("compiles pattern label against pattern analysis", () => {
    const ast = parseQuery("pattern:jumpstream");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("pa.shape_pattern");
    expect(compiled.sql).toContain("pa.secondary_shape");
    expect(compiled.params).toEqual(["%jumpstream%", "%jumpstream%"]);
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
  });

  test("compiles combined key and pattern with matching bind count", () => {
    const ast = parseQuery("key=7 pattern:chordstream");
    const compiled = compileQuery(ast);
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
    expect(compiled.params).toEqual([
      "mania",
      7,
      "%chordstream%",
      "%chordstream%",
    ]);
  });

  test("compiles axis rc against rework ln_ratio", () => {
    const ast = parseQuery("key=7 axis:rc pattern:jack");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr_r.ln_ratio");
    expect(compiled.sql).toContain("pa.dominant_pattern");
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length);
    expect(compiled.params).toEqual(["mania", 7, 0.2, "%jack%", "%jack%"]);
  });

  test("compiles axis ln against rework ln_ratio", () => {
    const ast = parseQuery("axis:ln");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("dr_r.ln_ratio >=");
    expect(compiled.sql).toContain("dr_r.ln_ratio <");
    expect(compiled.params).toEqual([0.2, 0.8]);
  });

  test("compiles status filter against beatmap set status", () => {
    const ast = parseQuery("mode:mania key=7 ranked");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("bs.status");
    expect(compiled.sql).toContain("b.online_id > 0");
    expect(compiled.params).toEqual(["mania", "mania", 7, 1]);
  });

  test("compiles multiple statuses as IN list", () => {
    const ast = parseQuery("status:ranked,loved");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("bs.status IN");
    expect(compiled.sql).toContain("b.online_id > 0");
    expect(compiled.params).toEqual([1, 4]);
  });

  test("compiles graveyard status with online_id constraint", () => {
    const ast = parseQuery("status=g");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("bs.status =");
    expect(compiled.sql).toContain("b.online_id > 0");
    expect(compiled.params).toEqual([-2]);
  });

  test("compiles local status without online_id constraint", () => {
    const ast = parseQuery("status:none");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("bs.status =");
    expect(compiled.sql).not.toContain("b.online_id > 0");
    expect(compiled.params).toEqual([-3]);
  });

  test("compiles mixed online and local statuses with OR", () => {
    const ast = parseQuery("status:graveyard,none");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("b.online_id > 0");
    expect(compiled.sql).toContain(" OR ");
    expect(compiled.params).toEqual([-2, -3]);
  });

  test("compiles NOT played:lastNd with correct parentheses", () => {
    const ast = parseQuery("acc:90..93 NOT played:last14d");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("NOT (m.last_played_at IS NOT NULL AND");
  });

  test("parses grade filter", () => {
    expect(parseQuery("grade:X")).toEqual({
      type: "term",
      term: { type: "grade", value: "X" },
    });
    expect(parseQuery("grade:SS")).toEqual({
      type: "term",
      term: { type: "grade", value: "SS" },
    });
    expect(parseQuery("rank:S")).toEqual({
      type: "term",
      term: { type: "grade", value: "S" },
    });
  });

  test("compiles grade filter against any nomod/mirror score", () => {
    const ast = parseQuery("key=7 grade:SS");
    const compiled = compileQuery(ast);
    expect(compiled.sql).toContain("EXISTS");
    expect(compiled.params).toContain("SS");
  });

  test("parses fln axis", () => {
    expect(parseQuery("axis:fln")).toEqual({
      type: "term",
      term: { type: "axis", value: "fln" },
    });
  });
});
