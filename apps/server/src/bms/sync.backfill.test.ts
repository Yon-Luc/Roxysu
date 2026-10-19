import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  beatmapSets,
  beatmaps,
  bmsSyncQueue,
  closeDb,
  ensureDb,
  scores,
} from "@roxysu/db/client.bun";
import { BMS_BACKFILL_STATUS_KEY, BMS_HUB_JWT_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { eq } from "drizzle-orm";
import { deriveBmsScores } from "./derive";
import { listLocalScores } from "./localProfile";
import { readSetting, writeSetting } from "./settings";
import { drainBmsQueue, enqueueHistoricalPage, recoverStuckUploads } from "./sync";

const SET_ID = "00000000-0000-4000-8000-0000000000a1";
const MAP_ID = "00000000-0000-4000-8000-0000000000b1";
const MD5 = "ab".repeat(16);
const PLAYS = 250;

let db: Db;
let tmpDir: string;

function scoreId(index: number): string {
  return `bms-${String(index).padStart(4, "0")}`;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-backfill-"));
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
  const rows = [];
  for (let i = 0; i < PLAYS; i++) {
    rows.push({
      id: scoreId(i),
      onlineId: 0,
      legacyOnlineId: 0,
      beatmapId: MAP_ID,
      rulesetShortName: "bms",
      totalScore: 500_000,
      accuracy: 0.9,
      mods: "[]",
      statistics: JSON.stringify({ perfect: 10, great: 0 }),
      maximumStatistics: JSON.stringify({ perfect: 10 }),
      playedAt: new Date(Date.UTC(2024, 0, 1) + i * 60_000),
      userUsername: "player",
    });
  }
  rows.push({
    id: "bms-auto",
    onlineId: 0,
    legacyOnlineId: 0,
    beatmapId: MAP_ID,
    rulesetShortName: "bms",
    totalScore: 1,
    accuracy: 1,
    mods: JSON.stringify([{ acronym: "AT" }]),
    statistics: JSON.stringify({ perfect: 10, great: 0 }),
    maximumStatistics: JSON.stringify({ perfect: 10 }),
    playedAt: new Date("2024-06-01T00:00:00.000Z"),
    userUsername: "player",
  });
  for (let i = 0; i < rows.length; i += 80) {
    await db.insert(scores).values(rows.slice(i, i + 80));
  }
  await deriveBmsScores(db, null);
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("BMS backfill resume", () => {
  test("pages through history, resumes stuck uploads, and does not requeue synced scores", async () => {
    const first = await enqueueHistoricalPage(db);
    expect(first).toBe(200);
    expect(await readSetting(db, BMS_BACKFILL_STATUS_KEY)).toBe("running");

    await db
      .update(bmsSyncQueue)
      .set({ state: "uploading" })
      .where(eq(bmsSyncQueue.scoreId, scoreId(0)));
    await db
      .update(bmsSyncQueue)
      .set({ state: "synced", hubScoreId: "hub-kept" })
      .where(eq(bmsSyncQueue.scoreId, scoreId(1)));
    await recoverStuckUploads(db);
    const recovered = await db
      .select()
      .from(bmsSyncQueue)
      .where(eq(bmsSyncQueue.scoreId, scoreId(0)))
      .get();
    expect(recovered?.state).toBe("pending");
    const kept = await db
      .select()
      .from(bmsSyncQueue)
      .where(eq(bmsSyncQueue.scoreId, scoreId(1)))
      .get();
    expect(kept?.state).toBe("synced");
    expect(kept?.hubScoreId).toBe("hub-kept");

    const second = await enqueueHistoricalPage(db);
    expect(second).toBe(50);
    const third = await enqueueHistoricalPage(db);
    expect(third).toBe(0);
    const auto = await db.select().from(bmsSyncQueue).where(eq(bmsSyncQueue.scoreId, "bms-auto")).get();
    expect(auto).toBeUndefined();
    const still = await db
      .select()
      .from(bmsSyncQueue)
      .where(eq(bmsSyncQueue.scoreId, scoreId(1)))
      .get();
    expect(still?.state).toBe("synced");

    await writeSetting(db, BMS_HUB_JWT_KEY, "token");
    const seen: string[] = [];
    const drained = await drainBmsQueue(db, {
      force: true,
      limit: 5,
      post: async (body) => {
        for (const score of body.scores) seen.push(score.localScoreId);
        return {
          ok: true as const,
          results: body.scores.map((score) => ({
            localScoreId: score.localScoreId,
            status: "accepted" as const,
            scoreId: `hub-${score.localScoreId}`,
          })),
        };
      },
    });
    expect(drained.uploaded).toBe(5);
    expect(seen).not.toContain(scoreId(1));
    const again = await drainBmsQueue(db, {
      force: true,
      limit: 5,
      post: async (body) => {
        for (const score of body.scores) {
          if (seen.includes(score.localScoreId)) {
            throw new Error(`duplicate upload ${score.localScoreId}`);
          }
        }
        return {
          ok: true as const,
          results: body.scores.map((score) => ({
            localScoreId: score.localScoreId,
            status: "accepted" as const,
            scoreId: `hub-${score.localScoreId}`,
          })),
        };
      },
    });
    expect(again.uploaded).toBe(5);
  });

  test("score history stays on a bounded page", async () => {
    const page = await listLocalScores(db, { variant: "standard", limit: 20 });
    expect(page.scores).toHaveLength(20);
    expect(page.nextCursor).toBeTruthy();
    const next = await listLocalScores(db, {
      variant: "standard",
      limit: 20,
      cursor: page.nextCursor,
    });
    expect(next.scores).toHaveLength(20);
    const ids = new Set([...page.scores, ...next.scores].map((score) => score.id));
    expect(ids.size).toBe(40);
  });
});

describe("migration keeps existing scores", () => {
  test("running migrations again leaves a stored score in place", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-migrate-"));
    const stored = ensureDb(path.join(dir, "test.sqlite"));
    await stored.insert(scores).values({
      id: "pre-migration",
      onlineId: 7,
      legacyOnlineId: 0,
      totalScore: 42,
      playedAt: new Date("2020-01-01T00:00:00.000Z"),
      rulesetShortName: "osu",
    });
    const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/db/drizzle");
    migrate(stored as Parameters<typeof migrate>[0], { migrationsFolder: folder });
    const row = await stored.select().from(scores).where(eq(scores.id, "pre-migration")).get();
    expect(row?.totalScore).toBe(42);
    expect(row?.rulesetShortName).toBe("osu");
    closeDb(stored);
    rmSync(dir, { recursive: true, force: true });
  });
});
