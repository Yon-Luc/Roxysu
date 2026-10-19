import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { onlineScoreCandidates, settings } from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "../db-runtime";
import { resetRealmWriteLockForTests } from "../shared/realmWriteLock";
import { candidateSummary, commitOnlineScores, previewOnlineScores } from "./pull";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "..", "..", "..", "packages", "db", "drizzle");

let db: Db;

beforeAll(() => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
});

afterAll(() => closeDb(db));

beforeEach(async () => {
  await db.delete(onlineScoreCandidates);
});

afterEach(() => resetRealmWriteLockForTests());

function candidate(scoreId: number): typeof onlineScoreCandidates.$inferInsert {
  return {
    scoreId,
    ruleset: "mania",
    osuUserId: 7,
    beatmapOnlineId: 100 + scoreId,
    versionMismatch: false,
    payloadJson: JSON.stringify({ scoreId, userOnlineId: 7, username: "tester" }),
  };
}

async function scoreIds(): Promise<number[]> {
  const rows = await db.select().from(onlineScoreCandidates);
  return rows.map((r) => r.scoreId).sort((a, b) => a - b);
}

async function pauseValue(): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY));
  return rows[0]?.value;
}

describe("online score commit vs preview", () => {
  test("preview is rejected while a commit is in flight", async () => {
    await db.insert(onlineScoreCandidates).values([candidate(1), candidate(2)]);

    let releaseWrite!: () => void;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    let writing!: () => void;
    const writeStarted = new Promise<void>((resolve) => (writing = resolve));

    const commit = commitOnlineScores(db, {
      settleMs: 0,
      write: async () => {
        writing();
        await gate;
        return { ok: true, added: 2, skipped: 0, backupPath: "x" };
      },
    });
    await writeStarted;

    const preview = await previewOnlineScores(db, {
      hubJwt: "unused-because-rejected-first",
      ruleset: "mania",
    });
    expect(preview).toMatchObject({ code: "in_flight" });
    expect(await scoreIds()).toEqual([1, 2]);

    const second = await commitOnlineScores(db, { settleMs: 0 });
    expect(second).toMatchObject({ ok: false, code: "in_flight" });
    expect(await pauseValue()).toBe("1");

    releaseWrite();
    expect(await commit).toMatchObject({ ok: true });
    expect(await scoreIds()).toEqual([]);
    expect(await pauseValue()).toBe("0");
  });

  test("commit deletes only the rows it wrote, not a newer preview's rows", async () => {
    await db.insert(onlineScoreCandidates).values([candidate(1), candidate(2)]);

    const result = await commitOnlineScores(db, {
      settleMs: 0,
      write: async (writeDb) => {
        // A newer candidate set lands while the Realm write is running.
        await writeDb.insert(onlineScoreCandidates).values([candidate(3)]);
        return { ok: true, added: 2, skipped: 0, backupPath: "x" };
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(await scoreIds()).toEqual([3]);
    expect(await candidateSummary(db)).toMatchObject({ waiting: 1 });
  });

  test("a failed write keeps every candidate row and releases the pause", async () => {
    await db.insert(onlineScoreCandidates).values([candidate(1), candidate(2)]);
    const result = await commitOnlineScores(db, {
      settleMs: 0,
      write: async () => ({ ok: false, error: "locked", code: "locked" }),
    });
    expect(result).toMatchObject({ ok: false, code: "locked" });
    expect(await scoreIds()).toEqual([1, 2]);
    expect(await pauseValue()).toBe("0");
  });

  test("a throwing write releases the lock and the pause", async () => {
    await db.insert(onlineScoreCandidates).values([candidate(1)]);
    await expect(
      commitOnlineScores(db, {
        settleMs: 0,
        write: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(await pauseValue()).toBe("0");
    const again = await commitOnlineScores(db, {
      settleMs: 0,
      write: async () => ({ ok: true, added: 1, skipped: 0, backupPath: "x" }),
    });
    expect(again).toMatchObject({ ok: true });
  });
});
