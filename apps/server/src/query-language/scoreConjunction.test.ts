import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { compileQuery } from "./compile";
import { parseQuery } from "./parse";

function compiled(query: string, username?: string, gamemode?: string) {
  return compileQuery(parseQuery(query), {
    username: username ? [username] : null,
    gamemode: gamemode ?? null,
  });
}

describe("score conjunction compile", () => {
  test("acc alone stays the mastery best", () => {
    const { sql } = compiled("acc<95");
    expect(sql).toContain("m.best_accuracy");
    expect(sql).not.toContain("HAVING");
  });

  test("mod:IN acc<95 uses the best Invert accuracy", () => {
    const { sql, params } = compiled("mod:IN acc<95");
    expect(sql).toContain("MAX(s.accuracy)");
    expect(sql).toContain("HAVING");
    expect(sql).toContain("s.mods LIKE ?");
    expect(sql).not.toContain("m.best_accuracy");
    expect(params).toEqual(["%IN%", 0.95]);
  });

  test("a nomod filter across OR stays independent", () => {
    const { sql, params } = compiled("mod:IN OR acc<95");
    expect(sql).toContain("m.best_accuracy");
    expect(sql).toContain("EXISTS");
    expect(sql).not.toContain("HAVING");
    expect(params).toEqual(["%IN%", 0.95]);
  });

  test("negated mods do not pull accuracy onto that score", () => {
    const { sql, params } = compiled("acc>98 NOT mods:NF");
    expect(sql).toContain("m.best_accuracy");
    expect(sql).toContain("NOT");
    expect(sql).not.toContain("HAVING");
    expect(params).toEqual([0.98, "%NF%"]);
  });

  test("ANDed mods must be on the same score", () => {
    const { sql, params } = compiled("mod:IN mod:DT acc<95");
    expect(sql.match(/EXISTS/g)).toHaveLength(1);
    expect(sql).toContain("AND s.mods LIKE ?");
    expect(params).toEqual(["%IN%", "%DT%", 0.95]);
  });

  test("OR of mods scopes the best accuracy to either mod", () => {
    const { sql, params } = compiled("(mod:IN OR mod:DT) acc<95");
    expect(sql).toContain("MAX(s.accuracy)");
    expect(sql).toContain("OR s.mods LIKE ?");
    expect(sql).not.toContain("m.best_accuracy");
    expect(params).toEqual(["%IN%", "%DT%", 0.95]);
  });

  test("beatmap fields stay outside the score aggregate", () => {
    const { sql, params } = compiled("key=7 mod:IN acc<95");
    expect(sql).toContain("b.circle_size");
    expect(sql).toContain("MAX(s.accuracy)");
    expect(params).toContain("mania");
    expect(params).toContain(7);
    expect(params).toContain("%IN%");
    expect(params).toContain(0.95);
  });

  test("misses, score, and pp aggregate over the same mod set", () => {
    expect(compiled("mod:IN misses<5").sql).toContain(
      "MIN(CAST(json_extract(s.statistics, '$.miss') AS INTEGER))",
    );
    expect(compiled("mod:IN score>=900000").sql).toContain("MAX(s.total_score)");
    expect(compiled("mod:IN pp>=200").sql).toContain("MAX(s.pp)");
    expect(compiled("mod:IN acc:90..95").params).toEqual(["%IN%", 0.9, 0.95]);
  });

  test("username and gamemode scope the Invert scores", () => {
    const { params } = compiled("mod:IN acc<95", "alice", "mania");
    expect(params).toEqual(["alice", "mania", "%IN%", 0.95]);
  });

  test("grade stays a separate nomod check", () => {
    const { sql } = compiled("grade:S mod:IN");
    expect(sql).not.toContain("HAVING");
    expect(sql).toContain("s.mods LIKE ?");
  });
});

describe("score conjunction sql", () => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE beatmaps (id TEXT PRIMARY KEY)`);
  db.run(`CREATE TABLE scores (
    beatmap_id TEXT,
    delete_pending INTEGER,
    user_username TEXT,
    ruleset_short_name TEXT,
    mods TEXT,
    accuracy REAL,
    total_score INTEGER,
    pp REAL,
    statistics TEXT
  )`);

  function addMap(id: string) {
    db.run("INSERT INTO beatmaps (id) VALUES (?)", [id]);
  }

  function addScore(
    beatmapId: string,
    mods: string,
    accuracy: number,
    statistics = '{"miss":0}',
  ) {
    db.run(
      `INSERT INTO scores (
        beatmap_id, delete_pending, mods, accuracy, total_score, pp, statistics
      ) VALUES (?, 0, ?, ?, 0, NULL, ?)`,
      [beatmapId, mods, accuracy, statistics],
    );
  }

  function matches(id: string, query: string): boolean {
    const { sql, params } = compiled(query);
    const row = db
      .query(`SELECT 1 AS hit FROM beatmaps b WHERE b.id = ? AND (${sql})`)
      .get(id, ...params) as { hit: number } | null;
    return row != null;
  }

  test("nomod does not count, and best Invert does", () => {
    addMap("cleared");
    addScore("cleared", '[{"acronym":"IN"}]', 0.99);
    addScore("cleared", "[]", 0.9);

    addMap("under");
    addScore("under", '[{"acronym":"IN"}]', 0.9);
    addScore("under", "[]", 0.99);

    addMap("both");
    addScore("both", '[{"acronym":"IN"}]', 0.9);
    addScore("both", '[{"acronym":"IN"}]', 0.99);

    addMap("nomod-only");
    addScore("nomod-only", "[]", 0.9);

    expect(matches("cleared", "mod:IN acc<95")).toBe(false);
    expect(matches("under", "mod:IN acc<95")).toBe(true);
    expect(matches("both", "mod:IN acc<95")).toBe(false);
    expect(matches("nomod-only", "mod:IN acc<95")).toBe(false);
    expect(matches("nomod-only", "NOT (mod:IN acc<95)")).toBe(true);
    expect(matches("cleared", "NOT (mod:IN acc<95)")).toBe(true);
    expect(matches("under", "NOT (mod:IN acc<95)")).toBe(false);
  });
});
