import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@roxysu/db/hub";
import { bmsCharts, bmsScores, hubUsers } from "@roxysu/db/hub";
import { profileSessions, type HubDb } from "./bms";

const MD5 = "ab".repeat(16);
const T0 = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

let db: HubDb;
let tmpDir: string;
let seq = 0;

async function seedScores(userId: number, times: number[]) {
  const rows = times.map((time) => ({
    id: `score-${userId}-${String(seq++).padStart(6, "0")}`,
    userId,
    installationId: "install",
    localScoreId: `local-${userId}-${seq}`,
    chartMd5: MD5,
    achievedAt: new Date(time),
    exScore: 10,
    normalizedScore: 500_000,
    variantId: "standard",
    modsJson: "[]",
  }));
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(bmsScores).values(rows.slice(i, i + 100));
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-hub-bms-sessions-"));
  const sqlite = new Database(path.join(tmpDir, "hub.sqlite"));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  migrate(db, { migrationsFolder: folder });
  await db.insert(hubUsers).values([
    { osuId: 1, username: "marathon", avatarUrl: "https://example.test/a" },
    { osuId: 2, username: "boundary", avatarUrl: "https://example.test/b" },
  ]);
  await db.insert(bmsCharts).values({ md5: MD5, title: "chart", artist: "anon", keyCount: 8 });
});

afterAll(() => {
  db.$client.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("profileSessions", () => {
  test("a session longer than one page keeps its true start and play count", async () => {
    // Older session (5 plays), a 3 h gap, one sitting of 950 plays one minute apart, a 2 h gap, a short session.
    const older = Array.from({ length: 5 }, (_, i) => T0 + i * MINUTE);
    const longStart = T0 + 3 * 60 * MINUTE;
    const long = Array.from({ length: 950 }, (_, i) => longStart + i * MINUTE);
    const lastLong = long[long.length - 1]!;
    const newestStart = lastLong + 2 * 60 * MINUTE;
    const newest = Array.from({ length: 3 }, (_, i) => newestStart + i * MINUTE);
    await seedScores(1, [...older, ...long, ...newest]);

    const result = await profileSessions(db, "marathon", null, null);
    expect(result?.sessions.map((s) => s.scoreCount)).toEqual([3, 950, 5]);
    expect(result?.sessions[1]?.startedAt).toBe(new Date(longStart).toISOString());
    expect(result?.sessions[1]?.endedAt).toBe(new Date(lastLong).toISOString());
    expect(result?.sessions[2]?.startedAt).toBe(new Date(T0).toISOString());
  });

  test("a gap of exactly 30 minutes does not split a session on a page boundary", async () => {
    // 400 plays one minute apart and one older play exactly 30 minutes before them (not more
    // than the session gap), so the page boundary sits inside one session of 401 plays.
    const start = T0;
    const times = [start];
    for (let i = 0; i < 400; i++) {
      times.push(times[times.length - 1]! + (i === 0 ? 30 * MINUTE : MINUTE));
    }
    await seedScores(2, times);
    const result = await profileSessions(db, "boundary", null, null);
    expect(result?.sessions).toHaveLength(1);
    expect(result?.sessions[0]?.scoreCount).toBe(401);
    expect(result?.sessions[0]?.startedAt).toBe(new Date(start).toISOString());
  });

  test("still returns at most 20 sessions", async () => {
    const times = Array.from({ length: 30 }, (_, i) => T0 + i * 2 * 60 * MINUTE);
    await db.insert(hubUsers).values({ osuId: 3, username: "many", avatarUrl: "https://example.test/c" });
    const [user] = await db.select().from(hubUsers).where(eq(hubUsers.username, "many"));
    await seedScores(user!.id, times);
    const result = await profileSessions(db, "many", null, null);
    expect(result?.sessions).toHaveLength(20);
    expect(result?.sessions[0]?.startedAt).toBe(new Date(times[29]!).toISOString());
  });
});
