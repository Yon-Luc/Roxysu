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
import { bmsScores, hubUsers } from "@roxysu/db/hub";
import {
  importTable,
  ingestBmsBatch,
  readBmsProfile,
  type BmsInbound,
  type HubDb,
} from "./bms";

const MD5 = "ab".repeat(16);

function inbound(localScoreId: string, userId = 999): BmsInbound {
  return {
    localScoreId,
    rulesetId: "bms",
    userId,
    chart: { md5: MD5, title: "chart", artist: "anon", keyCount: 8 },
    achievedAt: "2024-06-01T12:00:00.000Z",
    score: { exScore: 20, maxExScore: 20, normalizedScore: 1_000_000, accuracy: 1 },
    judgements: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, miss: 0 },
    gameplay: { variantId: "standard", gaugeId: null, djGrade: "max", mods: [] },
  };
}

let db: HubDb;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-hub-bms-"));
  const sqlite = new Database(path.join(tmpDir, "hub.sqlite"));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  migrate(db, { migrationsFolder: folder });
  await db.insert(hubUsers).values([
    { osuId: 1, username: "owner", avatarUrl: "https://example.test/a" },
    { osuId: 2, username: "other", avatarUrl: "https://example.test/b" },
  ]);
});

afterAll(() => {
  db.$client.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ingestBmsBatch", () => {
  test("stores the authenticated owner and ignores a client user id", async () => {
    const bad = inbound("score-bad", 999);
    bad.gameplay.variantId = "HS+CN";
    const mixed = await ingestBmsBatch(db, 1, "install-1", [inbound("score-ok", 999), bad]);
    expect(mixed.results.map((item) => item.status)).toEqual(["accepted", "rejected"]);
    const again = await ingestBmsBatch(db, 1, "install-1", [inbound("score-ok", 999)]);
    expect(again.results[0]?.status).toBe("duplicate");
    const stored = await db.select().from(bmsScores).where(eq(bmsScores.localScoreId, "score-ok"));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.userId).toBe(1);
    expect(stored[0]?.trust).toBe("community_submitted");
    const rejected = await db.select().from(bmsScores).where(eq(bmsScores.localScoreId, "score-bad"));
    expect(rejected).toHaveLength(0);
  });

  test("a private profile is hidden from anonymous and other viewers", async () => {
    await db.update(hubUsers).set({ bmsProfilePublic: false }).where(eq(hubUsers.id, 1));
    expect(await readBmsProfile(db, "owner", null)).toBeNull();
    expect(await readBmsProfile(db, "owner", 2)).toBeNull();
    expect(await readBmsProfile(db, "missing", 1)).toBeNull();
    const own = await readBmsProfile(db, "owner", 1);
    expect(own?.username).toBe("owner");
    expect(own?.plays).toBe(1);
  });

  test("table import stores one immutable version", async () => {
    const body = JSON.stringify({
      name: "Satellite",
      symbol: "sl",
      charts: [{ level: "1", md5: MD5, title: "chart" }],
    });
    const fetched = importTable(db, "https://stellabms.xyz/sl/header.json", async () => {
      return new Response(body, { status: 200 });
    });
    const created = await fetched;
    const again = await importTable(db, "https://stellabms.xyz/sl/header.json", async () => {
      return new Response(body, { status: 200 });
    });
    expect(created.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.versionId).toBe(created.versionId);
    expect(created.entries).toBe(1);
  });
});
