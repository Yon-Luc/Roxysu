import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { settings } from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "../db-runtime";
import { commitScoreTransfer } from "../score-transfer/transfer";
import { syncCollectionsToLazer } from "./syncCollections";
import {
  acquireExtractionPause,
  currentRealmWriteOwner,
  resetRealmWriteLockForTests,
  tryAcquireRealmWriteLock,
} from "./realmWriteLock";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "..", "..", "..", "packages", "db", "drizzle");

let db: Db;

beforeAll(() => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
});

afterAll(() => closeDb(db));

afterEach(() => resetRealmWriteLockForTests());

async function pauseValue(): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY));
  return rows[0]?.value;
}

describe("realm write lock", () => {
  test("a second concurrent Realm write is refused while the first holds the lock", async () => {
    const first = tryAcquireRealmWriteLock(db, "online_score_commit");
    expect(first).not.toBeNull();
    expect(currentRealmWriteOwner()).toBe("online_score_commit");
    expect(tryAcquireRealmWriteLock(db, "collection_write_back")).toBeNull();

    // Real writers surface the refusal as in_flight (HTTP 409 on their routes).
    const transfer = await commitScoreTransfer(db);
    expect(transfer).toMatchObject({ ok: false, code: "in_flight" });
    const writeBack = await syncCollectionsToLazer(db);
    expect(writeBack).toMatchObject({ ok: false, error: { code: "in_flight" } });

    await first!.release();
    expect(currentRealmWriteOwner()).toBeNull();
    const second = tryAcquireRealmWriteLock(db, "collection_write_back");
    expect(second).not.toBeNull();
    await second!.release();
  });

  test("the refused writers do not clear the holder's pause", async () => {
    const lease = tryAcquireRealmWriteLock(db, "online_score_commit")!;
    await lease.pauseExtraction(0);
    expect(await pauseValue()).toBe("1");

    await commitScoreTransfer(db);
    await syncCollectionsToLazer(db);
    expect(await pauseValue()).toBe("1");

    await lease.release();
    expect(await pauseValue()).toBe("0");
  });

  test("pause stays 1 until every holder has released", async () => {
    const releaseA = await acquireExtractionPause(db);
    const releaseB = await acquireExtractionPause(db);
    expect(await pauseValue()).toBe("1");

    await releaseA();
    expect(await pauseValue()).toBe("1");

    await releaseA(); // idempotent: must not drop B's hold
    expect(await pauseValue()).toBe("1");

    await releaseB();
    expect(await pauseValue()).toBe("0");
  });

  test("concurrent acquires and releases never leave the pause at 0 while held", async () => {
    const releases = await Promise.all([
      acquireExtractionPause(db),
      acquireExtractionPause(db),
      acquireExtractionPause(db),
    ]);
    await Promise.all([releases[0]!(), releases[1]!()]);
    expect(await pauseValue()).toBe("1");
    await releases[2]!();
    expect(await pauseValue()).toBe("0");
  });

  test("releases the pause and the lock when the writer throws", async () => {
    const run = async () => {
      const lease = tryAcquireRealmWriteLock(db, "score_transfer_commit")!;
      try {
        await lease.pauseExtraction(0);
        throw new Error("realm write blew up");
      } finally {
        await lease.release();
      }
    };
    await expect(run()).rejects.toThrow("realm write blew up");
    expect(await pauseValue()).toBe("0");
    expect(currentRealmWriteOwner()).toBeNull();
    expect(tryAcquireRealmWriteLock(db, "online_score_commit")).not.toBeNull();
  });

  test("release is idempotent", async () => {
    const lease = tryAcquireRealmWriteLock(db, "collection_write_back")!;
    await lease.pauseExtraction(0);
    await lease.release();
    const next = tryAcquireRealmWriteLock(db, "online_score_commit")!;
    await lease.release(); // stale lease must not release the new holder
    expect(currentRealmWriteOwner()).toBe("online_score_commit");
    await next.release();
  });
});
