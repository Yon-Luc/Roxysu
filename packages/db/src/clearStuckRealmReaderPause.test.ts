import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureDb, closeDb, settings, eq } from "./client.bun";
import { SYNC_REALM_READER_PAUSED_KEY } from "./settings-keys";
import { clearStuckRealmReaderPause } from "./clearStuckRealmReaderPause";
import type { Db } from "./types";

describe("clearStuckRealmReaderPause", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-pause-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("no-ops when pause is unset", () => {
    expect(clearStuckRealmReaderPause(db)).toBe(false);
  });

  test("no-ops when pause is already 0", () => {
    db.insert(settings)
      .values({ key: SYNC_REALM_READER_PAUSED_KEY, value: "0" })
      .run();
    expect(clearStuckRealmReaderPause(db)).toBe(false);
  });

  test("clears stuck pause=1", () => {
    db.insert(settings)
      .values({ key: SYNC_REALM_READER_PAUSED_KEY, value: "1" })
      .run();

    expect(clearStuckRealmReaderPause(db)).toBe(true);

    const row = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY))
      .get();
    expect(row?.value).toBe("0");
    expect(clearStuckRealmReaderPause(db)).toBe(false);
  });
});
