import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
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
  getCachedPlayerStats,
  setCachedPlayerStats,
} from "../analytics/playerStatsCache";
import { backfillDanVariants } from "./computeDanVariants";
import { __danVariantJobTesting as jobTest } from "./danVariantJob";

const SET_ID = "00000000-0000-0000-0000-000000000030";
const MAP_4K = "00000000-0000-0000-0000-000000000031";
const HASH_4K = "bb".repeat(32);

let db: Db;
let tmpDir: string;
let prevOsuDataPath: string | undefined;
let nextImportId = 0;

function maniaOsuText(): string {
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
    const x = (((i % 4) + 1) * 512) / 4;
    lines.push(`${x},192,${t},1,0,0:0:0:0:`);
    t += 166;
  }
  return lines.join("\n");
}

function insertScore(id: string, mods: unknown[]): void {
  db.$client
    .query(
      `INSERT INTO scores (
        id, online_id, legacy_online_id, beatmap_id, ruleset_short_name,
        total_score, total_score_without_mods, accuracy, rank, mods,
        played_at, delete_pending
      ) VALUES (?, 1, 1, ?, 'mania', 100000, 100000, 0.98, 'S', ?, ?, 0)`,
    )
    .run(id, MAP_4K, JSON.stringify(mods), Date.now());
}

/** A successful import whose delta is unknown (bootstrap / large reconcile). */
function insertNullDeltaImport(): void {
  nextImportId += 1;
  db.$client
    .query(
      `INSERT INTO imports (id, kind, status, started_at, realm_schema_version, changed_score_ids)
       VALUES (?, 'full', 'success', ?, 1, NULL)`,
    )
    .run(nextImportId, Date.now());
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-danvariantjob-"));
  const osuDir = path.join(tmpDir, "osu");
  const filePath = path.join(
    osuDir,
    "files",
    HASH_4K[0]!,
    HASH_4K.slice(0, 2),
    HASH_4K,
  );
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, maniaOsuText());
  prevOsuDataPath = process.env.OSU_DATA_PATH;
  process.env.OSU_DATA_PATH = osuDir;

  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 2, dateAdded: new Date(), status: 2 })
    .run();
  db.insert(beatmaps)
    .values({
      id: MAP_4K,
      setId: SET_ID,
      onlineId: 201,
      hash: HASH_4K,
      status: 2,
      length: 30,
      bpm: 180,
      starRating: 4,
      rulesetShortName: "mania",
      circleSize: 4,
    })
    .run();
});

afterAll(() => {
  if (prevOsuDataPath === undefined) delete process.env.OSU_DATA_PATH;
  else process.env.OSU_DATA_PATH = prevOsuDataPath;
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  jobTest.cancelTimers();
  jobTest.reset();
  db.$client.query(`DELETE FROM scores`).run();
  db.$client.query(`DELETE FROM beatmap_dan_rating_variants`).run();
  db.$client.query(`DELETE FROM imports`).run();
  nextImportId = 0;
});

function seedThreeCombos(): void {
  insertScore("s-dt11", [{ acronym: "DT", settings: { speed_change: 1.1 } }]);
  insertScore("s-dt12", [{ acronym: "DT", settings: { speed_change: 1.2 } }]);
  insertScore("s-in", ["IN"]);
}

function variantRowCount(): number {
  return (
    db.$client
      .query(`SELECT COUNT(*) AS n FROM beatmap_dan_rating_variants`)
      .get() as { n: number }
  ).n;
}

describe("F-017 memory guard and yielding", () => {
  test("pauses without computing while memory is under pressure, then resumes", async () => {
    seedThreeCombos();
    jobTest.enqueueFullScan(db);
    expect(jobTest.queueSize()).toBe(3);
    jobTest.setMemoryPressure(() => true);
    jobTest.startRun(db);
    jobTest.cancelTimers();

    await jobTest.runBatch();
    expect(jobTest.state().status).toBe("paused");
    expect(variantRowCount()).toBe(0);
    expect(jobTest.queueSize()).toBe(3);

    // A paused job re-checks on its own; pressure still on -> stays paused.
    jobTest.cancelTimers();
    await jobTest.runBatch();
    expect(jobTest.state().status).toBe("paused");
    expect(variantRowCount()).toBe(0);

    jobTest.setMemoryPressure(() => false);
    jobTest.cancelTimers();
    await jobTest.runBatch();
    expect(jobTest.state().status).toBe("completed");
    expect(variantRowCount()).toBeGreaterThan(0);
    expect(jobTest.queueSize()).toBe(0);
  });

  test("pressure that appears mid-batch stops after the running combo and keeps the rest queued", async () => {
    seedThreeCombos();
    jobTest.enqueueFullScan(db);
    let probes = 0;
    // 1: batch-level guard, 2: before combo 1, 3: before combo 2 (trips).
    jobTest.setMemoryPressure(() => ++probes >= 3);
    jobTest.startRun(db);
    jobTest.cancelTimers();

    await jobTest.runBatch();
    expect(jobTest.state().status).toBe("paused");
    expect(jobTest.queueSize()).toBe(2);
    expect(variantRowCount()).toBeGreaterThan(0);
  });

  test("backfillDanVariants yields once per computed combo", async () => {
    seedThreeCombos();
    let yields = 0;
    const result = await backfillDanVariants(db, {
      yieldBetween: async () => {
        yields += 1;
      },
    });
    expect(result.attempted).toBe(3);
    expect(result.processed).toHaveLength(3);
    expect(yields).toBe(3);
  });

  test("backfillDanVariants stops before a combo when shouldContinue says no", async () => {
    seedThreeCombos();
    let calls = 0;
    const result = await backfillDanVariants(db, {
      yieldBetween: async () => {},
      shouldContinue: () => ++calls <= 1,
    });
    expect(result.stoppedEarly).toBe(true);
    expect(result.processed).toHaveLength(1);
  });
});

describe("F-018 stats cache invalidation on finish", () => {
  test("finishing a run that wrote variants drops cached /stats payloads", () => {
    setCachedPlayerStats("k-variants", { skill: "stale" });
    jobTest.state().computedThisRun = 2;
    jobTest.finish("completed");
    expect(getCachedPlayerStats("k-variants")).toBeNull();
  });

  test("finishing a run that wrote nothing keeps the cache", () => {
    setCachedPlayerStats("k-nothing", { skill: "fresh" });
    jobTest.state().computedThisRun = 0;
    jobTest.finish("completed");
    expect(getCachedPlayerStats("k-nothing")).not.toBeNull();
  });
});

describe("F-019 null score delta", () => {
  test("does not re-queue the library once a full scan covered the score set", () => {
    seedThreeCombos();
    jobTest.state().lastImportId = 0;
    jobTest.enqueueFullScan(db);
    expect(jobTest.queueSize()).toBe(3);
    // Boot work done.
    jobTest.state().queue.clear();

    insertNullDeltaImport();
    jobTest.enqueueNewImports(db);
    expect(jobTest.queueSize()).toBe(0);
    expect(jobTest.state().lastImportId).toBe(1);
  });

  test("falls back to a full scan when the score set changed since the last one", () => {
    seedThreeCombos();
    jobTest.state().lastImportId = 0;
    jobTest.enqueueFullScan(db);
    jobTest.state().queue.clear();

    insertScore("s-dt13", [{ acronym: "DT", settings: { speed_change: 1.3 } }]);
    insertNullDeltaImport();
    jobTest.enqueueNewImports(db);
    expect(jobTest.queueSize()).toBe(4);

    // A second null delta over the same score set is now covered.
    jobTest.state().queue.clear();
    insertNullDeltaImport();
    jobTest.enqueueNewImports(db);
    expect(jobTest.queueSize()).toBe(0);
  });

  test("scans when no full scan has run in this process", () => {
    seedThreeCombos();
    jobTest.state().lastImportId = 0;
    insertNullDeltaImport();
    jobTest.enqueueNewImports(db);
    expect(jobTest.queueSize()).toBe(3);
  });
});
