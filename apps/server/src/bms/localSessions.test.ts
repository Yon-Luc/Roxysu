import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  beatmaps,
  bmsScoreDetails,
  closeDb,
  ensureDb,
  scores,
} from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { listLocalSessions } from "./localProfile";

const SET_ID = "00000000-0000-4000-8000-0000000000c1";
const MAP_ID = "00000000-0000-4000-8000-0000000000d1";
const MINUTE = 60_000;
const T0 = Date.UTC(2024, 0, 1);

let db: Db;
let tmpDir: string;
let seq = 0;

async function seedPlays(times: number[]) {
  const ids: string[] = [];
  const scoreRows = times.map((time) => {
    const id = `bms-${String(seq++).padStart(6, "0")}`;
    ids.push(id);
    return {
      id,
      onlineId: 0,
      legacyOnlineId: 0,
      beatmapId: MAP_ID,
      rulesetShortName: "bms",
      totalScore: 500_000,
      accuracy: 0.9,
      mods: "[]",
      statistics: "{}",
      maximumStatistics: "{}",
      playedAt: new Date(time),
      userUsername: "player",
    };
  });
  for (let i = 0; i < scoreRows.length; i += 80) {
    await db.insert(scores).values(scoreRows.slice(i, i + 80));
  }
  const detailRows = ids.map((scoreId) => ({
    scoreId,
    exScore: 10,
    maxExScore: 20,
    normalizedScore: 500_000,
    accuracy: 0.9,
    variantId: "standard",
    modAcronyms: "[]",
    updatedAt: new Date(),
  }));
  for (let i = 0; i < detailRows.length; i += 80) {
    await db.insert(bmsScoreDetails).values(detailRows.slice(i, i + 80));
  }
}

async function clearPlays() {
  await db.delete(bmsScoreDetails);
  await db.delete(scores);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-sessions-"));
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
    md5Hash: "ab".repeat(16),
    title: "fixture",
    artist: "anon",
    circleSize: 8,
    rulesetShortName: "bms",
  });
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("listLocalSessions", () => {
  test("a session longer than one page keeps its true start and play count", async () => {
    const older = Array.from({ length: 5 }, (_, i) => T0 + i * MINUTE);
    const longStart = T0 + 3 * 60 * MINUTE;
    const long = Array.from({ length: 950 }, (_, i) => longStart + i * MINUTE);
    const lastLong = long[long.length - 1]!;
    const newestStart = lastLong + 2 * 60 * MINUTE;
    const newest = Array.from({ length: 3 }, (_, i) => newestStart + i * MINUTE);
    await seedPlays([...older, ...long, ...newest]);

    const result = await listLocalSessions(db, null);
    expect(result.sessions.map((s) => s.scoreCount)).toEqual([3, 950, 5]);
    expect(result.sessions[1]?.startedAt).toBe(longStart);
    expect(result.sessions[1]?.endedAt).toBe(lastLong);
    expect(result.sessions[2]?.startedAt).toBe(T0);
  });

  test("a gap of exactly 30 minutes does not split a session on a page boundary", async () => {
    await clearPlays();
    // 400 plays one minute apart and one older play exactly 30 minutes before them.
    const times = [T0];
    for (let i = 0; i < 400; i++) {
      times.push(times[times.length - 1]! + (i === 0 ? 30 * MINUTE : MINUTE));
    }
    await seedPlays(times);
    const result = await listLocalSessions(db, null);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.scoreCount).toBe(401);
    expect(result.sessions[0]?.startedAt).toBe(T0);
  });

  test("still returns at most 20 sessions", async () => {
    await clearPlays();
    const times = Array.from({ length: 30 }, (_, i) => T0 + i * 2 * 60 * MINUTE);
    await seedPlays(times);
    const result = await listLocalSessions(db, null);
    expect(result.sessions).toHaveLength(20);
    expect(result.sessions[0]?.startedAt).toBe(times[29]!);
  });
});
