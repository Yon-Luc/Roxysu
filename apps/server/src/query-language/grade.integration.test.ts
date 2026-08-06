import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beatmapSets, beatmaps, closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { searchBeatmaps } from "./execute";
import { classifyScoreGrade, PERFECT_TOTAL_SCORE } from "./scoreGrade";

const SET_ID = "00000000-0000-0000-0000-000000000010";
const MAP_A = "00000000-0000-0000-0000-000000000011";
const MAP_B = "00000000-0000-0000-0000-000000000012";
const MAP_C = "00000000-0000-0000-0000-000000000013";

let db: Db;
let tmpDir: string;

function insertScore(
  id: string,
  beatmapId: string,
  totalScore: number,
  rank: number,
) {
  db.$client
    .prepare(
      `INSERT INTO scores (
        id, online_id, legacy_online_id, beatmap_id, ruleset_short_name,
        total_score, total_score_without_mods, accuracy, rank, mods,
        played_at, delete_pending
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      id,
      Math.floor(Math.random() * 1_000_000),
      Math.floor(Math.random() * 1_000_000),
      beatmapId,
      "mania",
      totalScore,
      totalScore,
      0.99,
      rank,
      "[]",
      Date.now(),
    );
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-grade-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));

  db.insert(beatmapSets)
    .values({
      id: SET_ID,
      onlineId: 1,
      dateAdded: new Date(),
      status: 2,
    })
    .run();

  db.insert(beatmaps)
    .values([
      {
        id: MAP_A,
        onlineId: 101,
        setId: SET_ID,
        difficultyName: "A",
        rulesetShortName: "mania",
        status: 2,
        length: 60,
        bpm: 180,
        starRating: 5,
        circleSize: 7,
        title: "Map A",
        artist: "Artist",
        hidden: false,
      },
      {
        id: MAP_B,
        onlineId: 102,
        setId: SET_ID,
        difficultyName: "B",
        rulesetShortName: "mania",
        status: 2,
        length: 60,
        bpm: 180,
        starRating: 5,
        circleSize: 7,
        title: "Map B",
        artist: "Artist",
        hidden: false,
      },
      {
        id: MAP_C,
        onlineId: 103,
        setId: SET_ID,
        difficultyName: "C",
        rulesetShortName: "mania",
        status: 2,
        length: 60,
        bpm: 180,
        starRating: 5,
        circleSize: 7,
        title: "Map C",
        artist: "Artist",
        hidden: false,
      },
    ])
    .run();

  // SS: rank X but below 1M (Perfect/Marvelous mix).
  insertScore("score-a-ss", MAP_A, 980_000, 6);
  // S on same map — should not steal grade:SS match.
  insertScore("score-a-s", MAP_A, 990_000, 5);
  insertScore("score-b-s", MAP_B, 990_000, 5);
  // X: all Marvelous (1M), even though rank is also X-grade.
  insertScore("score-c-x", MAP_C, PERFECT_TOTAL_SCORE, 6);
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("classifyScoreGrade", () => {
  test("1M is X, not SS", () => {
    expect(classifyScoreGrade(PERFECT_TOTAL_SCORE, 6)).toBe("X");
  });

  test("rank X below 1M is SS", () => {
    expect(classifyScoreGrade(980_000, 6)).toBe("SS");
  });
});

describe("grade query integration", () => {
  test("grade:SS matches Perfect/Marvelous scores below 1M", () => {
    const result = searchBeatmaps(db, "key=7 grade:SS", {
      page: 1,
      pageSize: 24,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(MAP_A);
  });

  test("grade:X matches only 1,000,000 scores", () => {
    const result = searchBeatmaps(db, "key=7 grade:X", {
      page: 1,
      pageSize: 24,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(MAP_C);
  });

  test("grade:S includes S scores", () => {
    const result = searchBeatmaps(db, "key=7 grade:S", {
      page: 1,
      pageSize: 24,
    });
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.id).sort()).toEqual([MAP_A, MAP_B].sort());
  });
});
