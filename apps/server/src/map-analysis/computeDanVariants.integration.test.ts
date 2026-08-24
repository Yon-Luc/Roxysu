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
import {
  backfillDanVariantsSync,
  collectDanVariantCombos,
  loadDanVariantRatingsSync,
} from "./computeDanVariants";
import { loadSevenKPlays } from "../analytics/recommend/sevenKSkill";

const SET_ID = "00000000-0000-0000-0000-000000000020";
const MAP_4K = "00000000-0000-0000-0000-000000000021";
const HASH_4K =
  "aa".repeat(32); // valid sha256 hex so lazer file resolution works

let db: Db;
let tmpDir: string;
let osuDir: string;

function maniaOsuText(): string {
  // 4K rice stream at ~180 BPM with a few holds (x column = (col+1)*512/4).
  const lines: string[] = [
    "osu file format v14",
    "[General]",
    "Mode: 3",
    "[Metadata]",
    "Title: test",
    "Artist: test",
    "Version: 4K NM",
    "[Difficulty]",
    "CircleSize: 4",
    "OverallDifficulty: 8",
    "[TimingPoints]",
    "0,333.333333333333,4,2,0,60,1,0",
    "[HitObjects]",
  ];
  let t = 1000;
  for (let i = 0; i < 64; i++) {
    const col = i % 4;
    const x = ((col + 1) * 512) / 4;
    if (i % 8 === 7) {
      lines.push(`${x},192,${t},128,0,${t + 200}:0:0:0:0:`);
    } else {
      lines.push(`${x},192,${t},1,0,0:0:0:0:`);
    }
    t += 166;
  }
  return lines.join("\n");
}

function insertScore(
  id: string,
  beatmapId: string,
  mods: unknown[],
) {
  db.$client
    .query(
      `INSERT INTO scores (
        id, online_id, legacy_online_id, beatmap_id, ruleset_short_name,
        total_score, total_score_without_mods, accuracy, rank, mods,
        played_at, delete_pending
      ) VALUES (?, ?, ?, ?, 'mania', 100000, 100000, 0.98, 'S', ?, ?, 0)`,
    )
    .run(id, 1, 1, beatmapId, JSON.stringify(mods), Date.now());
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-danvariants-"));
  osuDir = path.join(tmpDir, "osu");
  const filePath = path.join(
    osuDir,
    "files",
    HASH_4K[0]!,
    HASH_4K.slice(0, 2),
    HASH_4K,
  );
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, maniaOsuText());
  process.env.OSU_DATA_PATH = osuDir;

  db = ensureDb(path.join(tmpDir, "test.sqlite"));

  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();
  db.insert(beatmaps)
    .values({
      id: MAP_4K,
      setId: SET_ID,
      onlineId: 101,
      hash: HASH_4K,
      status: 2,
      length: 30,
      bpm: 180,
      starRating: 4,
      rulesetShortName: "mania",
      circleSize: 4,
    })
    .run();

  insertScore("s-nm", MAP_4K, []);
  insertScore("s-dt11", MAP_4K, [
    { acronym: "DT", settings: { speed_change: 1.1 } },
  ]);
  insertScore("s-in", MAP_4K, ["IN"]);
  insertScore("s-in-dt", MAP_4K, ["IN", "DT"]);
  insertScore("s-mr", MAP_4K, ["MR"]);
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

describe("collectDanVariantCombos", () => {
  test("derives distinct modded combos and skips NM-equivalent plays", () => {
    const combos = collectDanVariantCombos(db);
    const keys = combos.map((c) => `${c.beatmapId}|${c.rate}|${c.lnOnly}`);
    expect(keys).toContain(`${MAP_4K}|1.1|false`);
    expect(keys).toContain(`${MAP_4K}|1.5|true`);
    expect(keys).not.toContain(`${MAP_4K}|1|false`);
    expect(keys).toContain(`${MAP_4K}|1|true`);
  });

  test("restricts to the given score ids", () => {
    const combos = collectDanVariantCombos(db, ["s-dt11"]);
    expect(combos).toEqual([
      { beatmapId: MAP_4K, rate: 1.1, lnOnly: false },
    ]);
  });
});

describe("backfillDanVariantsSync", () => {
  test("computes sunny + daniel variants for played combos", () => {
    const first = backfillDanVariantsSync(db);
    expect(first.attempted).toBeGreaterThan(0);

    const sunny = loadDanVariantRatingsSync(db, [MAP_4K], "sunny");
    expect(sunny.size).toBe(3);
    for (const row of sunny.values()) {
      expect(row.error).toBeNull();
      expect(row.star).toBeGreaterThan(0);
      expect(row.columnCount).toBe(4);
    }

    // Invert converts the chart to full-LN → lnRatio jumps to ~1.
    const inRow = [...sunny.values()].find((r) => r.lnOnly)!;
    expect(inRow.lnRatio).toBeGreaterThanOrEqual(0.99);

    const daniel = loadDanVariantRatingsSync(db, [MAP_4K], "daniel");
    expect(daniel.size).toBe(3);

    // Everything fresh → nothing left to attempt.
    const second = backfillDanVariantsSync(db);
    expect(second.attempted).toBe(0);
  });
});

describe("skill consumption over variants", () => {
  test("modded plays use variant stars; unrated modded plays are dropped", () => {
    db.$client
      .query(
        `
        INSERT INTO beatmap_dan_ratings (
          beatmap_id, algorithm, beatmap_hash, sunny_star, ln_ratio,
          column_count, est_diff, error, updated_at
        ) VALUES (?, 'sunny', ?, 4.0, 0.1, 4, 'NM base', NULL, ?)
      `,
      )
      .run(MAP_4K, HASH_4K, Date.now());

    // A fresh DT play whose variant was never computed.
    insertScore("s-dt15", MAP_4K, ["DT"]);

    const before = loadSevenKPlays(db, 4);
    // NM + Mirror reads share the base rating; modded plays carry variant stars.
    expect(before.filter((p) => p.sunnyStar === 4.0).length).toBe(2);
    expect(before.filter((p) => p.sunnyStar != null && p.sunnyStar !== 4.0).length)
      .toBe(3);
    // The uncomputed DT@1.5 play is dropped (6 scores − 1 unrated modded).
    expect(before.length).toBe(5);

    // After the job runs, the DT@1.5 variant appears with its own star.
    backfillDanVariantsSync(db);
    const after = loadSevenKPlays(db, 4);
    expect(after.length).toBe(6);
    expect(new Set(after.map((p) => p.sunnyStar)).size).toBeGreaterThanOrEqual(4);
  });
});
