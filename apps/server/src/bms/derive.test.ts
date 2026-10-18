import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  beatmaps,
  bmsScoreDetails,
  bmsSyncQueue,
  closeDb,
  ensureDb,
  scores,
} from "@roxysu/db/client.bun";
import { BMS_HUB_JWT_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { eq } from "drizzle-orm";
import { deriveBmsScores, enqueueNewScores } from "./derive";
import { drainBmsQueue, enqueueHistoricalPage } from "./sync";
import { writeSetting } from "./settings";

const SET_ID = "00000000-0000-0000-0000-0000000000a1";
const MAP_ID = "00000000-0000-0000-0000-0000000000b1";
const BMS_A = "00000000-0000-0000-0000-0000000000c1";
const BMS_B = "00000000-0000-0000-0000-0000000000c2";
const OSU_ID = "00000000-0000-0000-0000-0000000000c3";
const MD5 = "ab".repeat(16);

let db: Db;
let tmpDir: string;

function score(id: string, ruleset: string, mods: string, statistics: string) {
  return {
    id,
    onlineId: 0,
    legacyOnlineId: 0,
    beatmapId: MAP_ID,
    rulesetShortName: ruleset,
    totalScore: 860363,
    accuracy: 3321 / 3860,
    mods,
    statistics,
    maximumStatistics: JSON.stringify({ perfect: 1930 }),
    playedAt: new Date("2024-06-01T12:00:00Z"),
  };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  await db.insert(beatmapSets).values({
    id: SET_ID,
    onlineId: 1,
    dateAdded: new Date(),
    status: 1,
  });
  await db.insert(beatmaps).values({
    id: MAP_ID,
    onlineId: 1,
    setId: SET_ID,
    status: 1,
    length: 90,
    bpm: 140,
    starRating: 1,
    md5Hash: MD5,
    hash: "cd".repeat(32),
    title: "fixture",
    artist: "anon",
    circleSize: 8,
    rulesetShortName: "bms",
  });
  await db.insert(scores).values([
    score(
      BMS_A,
      "bms",
      JSON.stringify([{ acronym: "HS" }, { acronym: "CN" }, { acronym: "C1" }, { acronym: "L1" }]),
      JSON.stringify({ perfect: 1413, great: 495, good: 14, ok: 5, meh: 3, miss: 11 }),
    ),
    score(
      BMS_B,
      "bms",
      JSON.stringify([{ acronym: "2P" }]),
      JSON.stringify({ perfect: 10, great: 0, miss: 0 }),
    ),
    score(OSU_ID, "osu", JSON.stringify([]), JSON.stringify({ great: 1, miss: 0 })),
  ]);
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("deriveBmsScores", () => {
  test("derives EX, variant, and gauge and leaves non-BMS scores alone", async () => {
    const written = await deriveBmsScores(db, null);
    expect(written).toBe(2);
    const a = await db.select().from(bmsScoreDetails).where(eq(bmsScoreDetails.scoreId, BMS_A)).get();
    expect(a?.exScore).toBe(1413 * 2 + 495);
    expect(a?.variantId).toBe("CN+HS+L1");
    expect(a?.gaugeId).toBe("class");
    expect(a?.clearLampId).toBeNull();
    const b = await db.select().from(bmsScoreDetails).where(eq(bmsScoreDetails.scoreId, BMS_B)).get();
    expect(b?.variantId).toBe("2P");
    expect(b?.gaugeId).toBeNull();
    const osu = await db.select().from(bmsScoreDetails).where(eq(bmsScoreDetails.scoreId, OSU_ID)).get();
    expect(osu).toBeUndefined();
  });

  test("a second enqueue does not reset a synced queue row", async () => {
    await enqueueNewScores(db, [BMS_A, BMS_B]);
    await db
      .update(bmsSyncQueue)
      .set({ state: "synced", hubScoreId: "hub-1" })
      .where(eq(bmsSyncQueue.scoreId, BMS_A));
    const inserted = await enqueueNewScores(db, [BMS_A, BMS_B]);
    expect(inserted).toBe(0);
    const row = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_A)).get();
    expect(row?.state).toBe("synced");
    expect(row?.hubScoreId).toBe("hub-1");
  });

  test("historical enqueue only fills missing rows and then reports done", async () => {
    const first = await enqueueHistoricalPage(db);
    expect(first).toBe(0);
    await db.delete(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_B));
    const resumed = await enqueueHistoricalPage(db);
    expect(resumed).toBe(1);
    const synced = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_A)).get();
    expect(synced?.state).toBe("synced");
    const pending = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_B)).get();
    expect(pending?.state).toBe("pending");
    const done = await enqueueHistoricalPage(db);
    expect(done).toBe(0);
  });

  test("one rejected batch item does not block the accepted item", async () => {
    await db
      .update(bmsSyncQueue)
      .set({ state: "pending", hubScoreId: null })
      .where(eq(bmsSyncQueue.scoreId, BMS_A));
    await writeSetting(db, BMS_HUB_JWT_KEY, "token");
    const outcome = await drainBmsQueue(db, {
      force: true,
      post: async () => ({
        ok: true as const,
        results: [
          { localScoreId: BMS_A, status: "duplicate" as const, scoreId: "hub-1" },
          { localScoreId: BMS_B, status: "rejected" as const, reason: "bad" },
        ],
      }),
    });
    expect(outcome.uploaded).toBe(1);
    const rejected = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_B)).get();
    expect(rejected?.state).toBe("rejected");
    const kept = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, BMS_A)).get();
    expect(kept?.state).toBe("synced");
  });
});
