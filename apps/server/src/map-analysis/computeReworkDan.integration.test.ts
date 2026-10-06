import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beatmapSets, beatmaps, closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import {
  REWORK_ALGORITHM,
  backfillReworkDanSync,
  countReworkDanMissing,
  computeReworkDanSync,
  getReworkDan,
  relabelReworkDanSync,
} from "./computeReworkDan";
import { reworkDanLabel } from "./reworkDan";

const SET_ID = "00000000-0000-0000-0000-0000000000d1";
const MAP_4K = "00000000-0000-0000-0000-0000000000d2";
const MAP_7K = "00000000-0000-0000-0000-0000000000d3";
const MAP_6K = "00000000-0000-0000-0000-0000000000d4";
/** Row that only ever records a failure, so healthy rows stay healthy. */
const MAP_BROKEN = "00000000-0000-0000-0000-0000000000d5";
const MAP_NOHASH = "00000000-0000-0000-0000-0000000000d6";
const HASH_BROKEN = "ff".repeat(32);
const HASH_4K = "bb".repeat(32);
const HASH_7K = "cc".repeat(32);
const HASH_6K = "dd".repeat(32);

let db: Db;
let tmpDir: string;
let osuDir: string;

function maniaOsuText(keyCount: number, notes: number, gapMs: number): string {
  const lines: string[] = [
    "osu file format v14",
    "[General]",
    "Mode: 3",
    "[Metadata]",
    "Title: test",
    "Artist: test",
    "Version: test",
    "[Difficulty]",
    `CircleSize: ${keyCount}`,
    "OverallDifficulty: 8",
    "[TimingPoints]",
    "0,300,4,2,0,60,1,0",
    "[HitObjects]",
  ];
  let t = 1000;
  for (let i = 0; i < notes; i += 1) {
    const col = i % keyCount;
    const x = ((col + 1) * 512) / keyCount;
    lines.push(`${x},192,${t},1,0,0:0:0:0:`);
    t += gapMs;
  }
  return lines.join("\n");
}

function writeChart(hash: string, text: string): void {
  const filePath = path.join(osuDir, "files", hash[0]!, hash.slice(0, 2), hash);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

function insertBeatmap(id: string, hash: string, keyCount: number): void {
  db.insert(beatmaps)
    .values({
      id,
      setId: SET_ID,
      onlineId: Math.floor(keyCount * 100),
      hash,
      status: 2,
      length: 30,
      bpm: 200,
      starRating: 4,
      rulesetShortName: "mania",
      circleSize: keyCount,
    })
    .run();
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-reworkdan-"));
  osuDir = path.join(tmpDir, "osu");
  writeChart(HASH_4K, maniaOsuText(4, 80, 70));
  writeChart(HASH_7K, maniaOsuText(7, 90, 65));
  writeChart(HASH_6K, maniaOsuText(6, 60, 80));
  process.env.OSU_DATA_PATH = osuDir;

  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();

  insertBeatmap(MAP_4K, HASH_4K, 4);
  insertBeatmap(MAP_7K, HASH_7K, 7);
  insertBeatmap(MAP_6K, HASH_6K, 6);
  // no .osu file was written for HASH_BROKEN
  insertBeatmap(MAP_BROKEN, HASH_BROKEN, 7);
  db.insert(beatmaps)
    .values({
      id: MAP_NOHASH,
      setId: SET_ID,
      onlineId: 999,
      hash: null,
      status: 2,
      length: 30,
      bpm: 200,
      starRating: 4,
      rulesetShortName: "mania",
      circleSize: 7,
    })
    .run();
});

afterAll(() => {
  delete process.env.OSU_DATA_PATH;
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("computeReworkDanSync", () => {
  test("stores a star rating and label under the rework algorithm id", () => {
    const result = computeReworkDanSync(db, MAP_4K, HASH_4K);
    expect(result.algorithm).toBe(REWORK_ALGORITHM);
    expect(result.error).toBeNull();
    expect(result.reworkStar).toBeGreaterThan(0);
    expect(result.columnCount).toBe(4);
    expect(result.estDiff).toBeTruthy();
  });

  test("the label matches a direct floor lookup for the stored star", () => {
    const stored = getReworkDan(db, MAP_4K);
    expect(stored).not.toBeNull();
    expect(stored!.estDiff).toBe(
      reworkDanLabel(stored!.reworkStar!, stored!.lnRatio!, stored!.columnCount!),
    );
  });

  test("7K charts get a Regular-tier label", () => {
    const result = computeReworkDanSync(db, MAP_7K, HASH_7K);
    expect(result.columnCount).toBe(7);
    expect(result.estDiff).toContain("Regular");
  });

  test("an unmapped key count still stores stars with an unknown label", () => {
    const result = computeReworkDanSync(db, MAP_6K, HASH_6K);
    expect(result.reworkStar).toBeGreaterThan(0);
    expect(result.columnCount).toBe(6);
    expect(result.estDiff).toBe("Unknown difficulty");
  });

  test("records a failure instead of throwing on a missing file", () => {
    const result = computeReworkDanSync(db, MAP_BROKEN, HASH_BROKEN);
    expect(result.error).toBeTruthy();
    expect(result.reworkStar).toBeNull();
    expect(result.estDiff).toBeNull();
  });

  test("records a failure when the hash is missing", () => {
    const result = computeReworkDanSync(db, MAP_NOHASH, null);
    expect(result.error).toBe("Beatmap hash missing");
  });
});

describe("relabelReworkDanSync", () => {
  test("skips rows that previously failed", () => {
    // Broken rows have no star, so they must stay untouched.
    const before = getReworkDan(db, MAP_BROKEN)!;
    relabelReworkDanSync(db);
    expect(getReworkDan(db, MAP_BROKEN)!.estDiff).toBe(before.estDiff);
  });

  test("rewrites labels from stored stars without re-reading charts", () => {
    const before = getReworkDan(db, MAP_4K)!;
    const now = Date.now();

    // Force a wrong label, then let the relabel pass repair it.
    db.$client
      .query(
        `UPDATE beatmap_dan_ratings SET est_diff = ?, updated_at = ?
         WHERE beatmap_id = ? AND algorithm = ?`,
      )
      .run("Stale Label mid", now, MAP_4K, REWORK_ALGORITHM);

    const relabeled = relabelReworkDanSync(db);
    expect(relabeled).toBeGreaterThanOrEqual(1);
    expect(getReworkDan(db, MAP_4K)!.estDiff).toBe(before.estDiff);
  });

  test("is a no-op when every label already matches", () => {
    relabelReworkDanSync(db);
    expect(relabelReworkDanSync(db)).toBe(0);
  });

  test("never touches sunny or daniel rows", () => {
    db.$client
      .query(
        `INSERT INTO beatmap_dan_ratings (
           beatmap_id, algorithm, sunny_star, ln_ratio, column_count,
           est_diff, error, updated_at
         ) VALUES (?, 'sunny', 4.2, 0, 4, 'Reform 1 low', NULL, ?)`,
      )
      .run(MAP_4K, Date.now());

    relabelReworkDanSync(db);

    const sunny = db.$client
      .query(
        `SELECT est_diff AS estDiff FROM beatmap_dan_ratings
         WHERE beatmap_id = ? AND algorithm = 'sunny'`,
      )
      .get(MAP_4K) as { estDiff: string };
    expect(sunny.estDiff).toBe("Reform 1 low");
  });
});

describe("backfillReworkDanSync", () => {
  /** Both rows that can never succeed: no file on disk, and no hash. */
  const FAILED = 2;

  function clearReworkRows(): void {
    db.$client
      .query(`DELETE FROM beatmap_dan_ratings WHERE algorithm = ?`)
      .run(REWORK_ALGORITHM);
  }

  test("rates every mania key mode on the first pass", () => {
    clearReworkRows();
    // `remaining` counts unrated-or-failed rows, matching the Sunny convention.
    expect(countReworkDanMissing(db)).toBe(5);

    const result = backfillReworkDanSync(db, { limit: 10 });
    expect(result.attempted).toBe(5);
    // 4K, 7K and 6K all rate; 6K stores a star with an unknown dan label.
    expect(result.succeeded).toBe(3);
    expect(result.remaining).toBe(FAILED);

    for (const id of [MAP_4K, MAP_7K, MAP_6K]) {
      const row = getReworkDan(db, id)!;
      expect(row.error).toBeNull();
      expect(row.reworkStar).toBeGreaterThan(0);
      expect(row.estDiff).toBeTruthy();
    }
  });

  test("does not retry permanent failures by default", () => {
    clearReworkRows();
    backfillReworkDanSync(db, { limit: 10 });
    const second = backfillReworkDanSync(db, { limit: 10 });
    expect(second.attempted).toBe(0);
    expect(second.succeeded).toBe(0);
  });

  test("includeFailed retries the failed rows without succeeding", () => {
    clearReworkRows();
    backfillReworkDanSync(db, { limit: 10 });
    const retry = backfillReworkDanSync(db, { limit: 10, includeFailed: true });
    expect(retry.attempted).toBe(FAILED);
    expect(retry.succeeded).toBe(0);
    expect(getReworkDan(db, MAP_BROKEN)!.error).toBeTruthy();
  });

  test("re-estimates when the stored beatmap hash goes stale", () => {
    clearReworkRows();
    backfillReworkDanSync(db, { limit: 10 });
    const before = getReworkDan(db, MAP_4K)!.estDiff;

    db.$client
      .query(
        `UPDATE beatmap_dan_ratings SET beatmap_hash = ? WHERE beatmap_id = ? AND algorithm = ?`,
      )
      .run("ee".repeat(32), MAP_4K, REWORK_ALGORITHM);

    const stale = backfillReworkDanSync(db, { limit: 10 });
    expect(stale.attempted).toBe(1);
    expect(getReworkDan(db, MAP_4K)!.beatmapHash).toBe(HASH_4K);
    expect(getReworkDan(db, MAP_4K)!.estDiff).toBe(before);
  });

  test("skipRelabel leaves cached labels alone", () => {
    db.$client
      .query(
        `UPDATE beatmap_dan_ratings SET est_diff = 'Keep Me' WHERE beatmap_id = ? AND algorithm = ?`,
      )
      .run(MAP_4K, REWORK_ALGORITHM);

    const result = backfillReworkDanSync(db, {
      limit: 10,
      skipRelabel: true,
    });
    expect(result.relabeled).toBe(0);
    expect(getReworkDan(db, MAP_4K)!.estDiff).toBe("Keep Me");
  });
});
