import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { parseScoreStatistics, scoreMissCountSql } from "./parseStatistics";

describe("parseScoreStatistics", () => {
  it("returns null for empty input", () => {
    expect(parseScoreStatistics(null)).toBeNull();
    expect(parseScoreStatistics("")).toBeNull();
    expect(parseScoreStatistics("not-json")).toBeNull();
  });

  it("parses mania judgment counts", () => {
    expect(
      parseScoreStatistics(
        JSON.stringify({
          perfect: 100,
          great: 12,
          good: 3,
          meh: 1,
          miss: 2,
        }),
      ),
    ).toEqual({
      perfect: 100,
      great: 12,
      good: 3,
      ok: 0,
      meh: 1,
      miss: 2,
    });
  });

  it("returns zeros when keys exist but all counts are zero", () => {
    expect(parseScoreStatistics(JSON.stringify({ miss: 0 }))).toEqual({
      perfect: 0,
      great: 0,
      good: 0,
      ok: 0,
      meh: 0,
      miss: 0,
    });
  });

  it("reads PascalCase and HitResult integer keys", () => {
    expect(parseScoreStatistics(JSON.stringify({ Perfect: 1000 }))).toEqual({
      perfect: 1000,
      great: 0,
      good: 0,
      ok: 0,
      meh: 0,
      miss: 0,
    });
    expect(
      parseScoreStatistics(JSON.stringify({ "6": 980, "5": 15, "1": 2 })),
    ).toEqual({
      perfect: 980,
      great: 15,
      good: 0,
      ok: 0,
      meh: 0,
      miss: 2,
    });
  });

  it("treats an omitted miss as 0 when another judgment is present", () => {
    expect(parseScoreStatistics(JSON.stringify({ perfect: 10 }))?.miss).toBe(0);
  });

  it("sql miss count reads Pascal and integer keys and treats an omitted miss as 0", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE scores (statistics TEXT)");
    const expr = scoreMissCountSql("statistics");
    for (const statistics of [
      '{"Miss":0}',
      '{"1":2,"6":10}',
      '{"6":1000}',
      '{"large_bonus":1}',
    ]) {
      db.run("INSERT INTO scores (statistics) VALUES (?)", [statistics]);
    }
    const rows = db.query(`SELECT ${expr} AS miss FROM scores`).all();
    expect(rows).toEqual([
      { miss: 0 },
      { miss: 2 },
      { miss: 0 },
      { miss: null },
    ]);
  });

  it("ignores unrelated statistics-only objects", () => {
    expect(
      parseScoreStatistics(JSON.stringify({ large_bonus: 4 })),
    ).toBeNull();
  });
});
