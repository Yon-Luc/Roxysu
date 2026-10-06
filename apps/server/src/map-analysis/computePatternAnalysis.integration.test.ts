import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
} from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { backfillPatternAnalysis } from "./computePatternAnalysis";
import { PATTERN_ALGORITHM } from "@roxysu/mania-pattern-analysis";

const SET_ID = "00000000-0000-0000-0000-0000000000e1";
const MAP_A = "00000000-0000-0000-0000-0000000000e2";
const MAP_B = "00000000-0000-0000-0000-0000000000e3";
const MAP_C = "00000000-0000-0000-0000-0000000000e4";
const HASH_A = "1a".repeat(32);
const HASH_B = "2b".repeat(32);
const HASH_C = "3c".repeat(32);

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
    const x = (((i % keyCount) + 1) * 512) / keyCount;
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

function countPatternRows(): number {
  const row = db.$client
    .query(
      `SELECT COUNT(*) AS n FROM beatmap_pattern_analysis WHERE algorithm = ?`,
    )
    .get(PATTERN_ALGORITHM) as { n: number };
  return Number(row.n);
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-patternbackfill-"));
  osuDir = path.join(tmpDir, "osu");
  writeChart(HASH_A, maniaOsuText(4, 80, 70));
  writeChart(HASH_B, maniaOsuText(7, 90, 65));
  writeChart(HASH_C, maniaOsuText(6, 60, 80));
  process.env.OSU_DATA_PATH = osuDir;

  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();

  insertBeatmap(MAP_A, HASH_A, 4);
  insertBeatmap(MAP_B, HASH_B, 7);
  insertBeatmap(MAP_C, HASH_C, 6);
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

describe("backfillPatternAnalysis", () => {
  test("rates every missing mania map", async () => {
    db.$client
      .query(`DELETE FROM beatmap_pattern_analysis WHERE algorithm = ?`)
      .run(PATTERN_ALGORITHM);

    const result = await backfillPatternAnalysis(db, { limit: 10 });

    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.stoppedEarly).toBe(false);
    expect(result.remaining).toBe(0);
    expect(countPatternRows()).toBe(3);
  });

  test("shouldContinue stops early and keeps already-rated maps", async () => {
    db.$client
      .query(`DELETE FROM beatmap_pattern_analysis WHERE algorithm = ?`)
      .run(PATTERN_ALGORITHM);

    let checks = 0;
    const result = await backfillPatternAnalysis(db, {
      limit: 10,
      shouldContinue: () => {
        checks += 1;
        return checks <= 2;
      },
    });

    // The job pauses between maps on low memory; ratings already written must
    // stay committed instead of rolling back the whole batch.
    expect(result.stoppedEarly).toBe(true);
    expect(result.attempted).toBe(2);
    expect(result.remaining).toBeNull();
    expect(countPatternRows()).toBe(2);

    // Resuming finishes the rest.
    const resumed = await backfillPatternAnalysis(db, { limit: 10 });
    expect(resumed.attempted).toBe(1);
    expect(countPatternRows()).toBe(3);
  });

  test("nothing missing reports a completed pass", async () => {
    const result = await backfillPatternAnalysis(db, { limit: 10 });
    expect(result.attempted).toBe(0);
    expect(result.remaining).toBe(0);
  });
});
