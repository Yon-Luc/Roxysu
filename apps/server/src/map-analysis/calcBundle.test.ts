import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapDanRatings,
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
} from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { and, eq } from "drizzle-orm";
import { applyCalcBundle, exportCalcBundleEntries } from "./calcBundle";
import { SUNNY_ALGORITHM } from "./computeSunnyDan";

const SET_ID = "00000000-0000-0000-0000-000000000030";
const MAP_A = "00000000-0000-0000-0000-000000000031";
const MAP_B = "00000000-0000-0000-0000-000000000032";
const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);

let db: Db;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-calcbundle-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));

  await db.insert(beatmapSets).values({
    id: SET_ID,
    onlineId: 1,
    dateAdded: new Date(),
    status: 1,
  });
  await db.insert(beatmaps).values([
    {
      id: MAP_A,
      onlineId: 100,
      setId: SET_ID,
      difficultyName: "A",
      hash: HASH_A,
      rulesetShortName: "mania",
      circleSize: 4,
      status: 1,
      length: 60,
      bpm: 180,
      starRating: 4,
    },
    {
      id: MAP_B,
      onlineId: 101,
      setId: SET_ID,
      difficultyName: "B",
      hash: HASH_B,
      rulesetShortName: "mania",
      circleSize: 4,
      status: 1,
      length: 60,
      bpm: 180,
      starRating: 4,
    },
  ]);

  await db.insert(beatmapDanRatings).values({
    beatmapId: MAP_A,
    algorithm: SUNNY_ALGORITHM,
    beatmapHash: HASH_A,
    sunnyStar: 5,
    lnRatio: 0.1,
    columnCount: 4,
    estDiff: "Regular 1 mid",
    error: null,
    updatedAt: new Date(),
  });
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyCalcBundle", () => {
  test("gap-fills missing rows and skips successful locals", async () => {
    const stats = await applyCalcBundle(db, [
      {
        beatmapHash: HASH_A,
        onlineBeatmapId: 100,
        algorithm: SUNNY_ALGORITHM,
        sunnyStar: 9,
        lnRatio: 0.9,
        columnCount: 4,
        estDiff: "SHOULD_NOT_OVERWRITE",
      },
      {
        beatmapHash: HASH_B,
        onlineBeatmapId: 101,
        algorithm: SUNNY_ALGORITHM,
        sunnyStar: 6.5,
        lnRatio: 0.2,
        columnCount: 4,
        estDiff: "Regular 2 mid",
      },
      {
        beatmapHash: "ff".repeat(32),
        algorithm: SUNNY_ALGORITHM,
        sunnyStar: 1,
        estDiff: "unmatched",
      },
    ]);

    expect(stats.skipped).toBe(1);
    expect(stats.applied).toBe(1);
    expect(stats.unmatched).toBe(1);

    const kept = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, SUNNY_ALGORITHM),
        ),
      )
      .get();
    expect(kept?.estDiff).toBe("Regular 1 mid");
    expect(kept?.sunnyStar).toBe(5);

    const filled = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, SUNNY_ALGORITHM),
        ),
      )
      .get();
    expect(filled?.estDiff).toBe("Regular 2 mid");
    expect(filled?.sunnyStar).toBe(6.5);
  });

  test("replaces failed local rows", async () => {
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_B,
      algorithm: "daniel",
      beatmapHash: HASH_B,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Boom",
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
      set: {
        error: "Boom",
        estDiff: null,
        sunnyStar: null,
        updatedAt: new Date(),
      },
    });

    const stats = await applyCalcBundle(db, [
      {
        beatmapHash: HASH_B,
        algorithm: "daniel",
        sunnyStar: 4,
        lnRatio: 0,
        columnCount: 4,
        estDiff: "Regular 0 mid",
      },
    ]);
    expect(stats.applied).toBe(1);

    const row = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, "daniel"),
        ),
      )
      .get();
    expect(row?.error).toBeNull();
    expect(row?.estDiff).toBe("Regular 0 mid");
  });

  test("export includes successful hash-matched rows only", async () => {
    const entries = await exportCalcBundleEntries(db);
    const sunny = entries.filter((e) => e.algorithm === SUNNY_ALGORITHM);
    expect(sunny.some((e) => e.beatmapHash === HASH_A)).toBe(true);
    expect(sunny.some((e) => e.beatmapHash === HASH_B)).toBe(true);
    expect(sunny.every((e) => e.estDiff != null)).toBe(true);
  });
});
